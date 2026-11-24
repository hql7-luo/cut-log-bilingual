import { isDay, todayLA } from "./dates.ts";
import { MEALS, MUSCLES, WORKOUT_KINDS, type Exercise, type FoodLog, type Meal, type Muscle, type Nutrition } from "./model.ts";
import { foodTotals, round } from "./nutrition.ts";

export const AGENT_TOKEN = /^cut_[A-Za-z0-9_-]{43}$/;
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
export const FOOD_ID = /^[A-Za-z0-9_-]{1,80}$/;
export const MAX_AGENT_BODY = 36_000;

type ExternalNutrition = { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
export type AgentFood = ExternalNutrition & {
  name: string; amount: number; unit: string; grams: number | null; source: "estimate" | "label" | "manual"; note: string;
  range?: { low: ExternalNutrition; high: ExternalNutrition };
};

export class AgentInputError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AgentInputError("invalid_body", "Expected a JSON object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, length: number, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.trim().length > length || /[\u0000-\u001f]/.test(value)) {
    throw new AgentInputError("invalid_field", `Invalid ${field}.`);
  }
  return value.trim();
}
function valueIn(n: unknown, min: number, max: number, field: string) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw new AgentInputError("invalid_field", `Invalid ${field}.`);
  return round(n, 3);
}

const nutrients = { kcal: 20_000, protein_g: 3000, carbs_g: 3000, fat_g: 3000 } as const;
function externalValues(body: Record<string, unknown>): ExternalNutrition {
  return Object.fromEntries(Object.entries(nutrients).map(([key, max]) => [key, valueIn(body[key], 0, max, key)])) as ExternalNutrition;
}

export function normalizeAgentFood(value: unknown): AgentFood {
  const body = object(value);
  const name = text(body.name, "name", 140);
  const amount = valueIn(body.amount, 0.001, 10_000, "amount");
  const unit = text(body.unit, "unit", 16).toLowerCase();
  const grams = body.grams == null ? (unit === "g" ? amount : null) : valueIn(body.grams, 0.001, 20_000, "grams");
  if (unit === "g" && grams !== amount) throw new AgentInputError("invalid_grams", "For unit g, grams must equal amount.");
  const source = body.source ?? "estimate";
  if (source !== "estimate" && source !== "label" && source !== "manual") throw new AgentInputError("invalid_source", "Use estimate, label or manual.");
  const result: AgentFood = { name, amount, unit, grams, ...externalValues(body), source,
    note: body.note == null ? "" : text(body.note, "note", 350, true) };
  if (body.range != null) {
    if (source !== "estimate") throw new AgentInputError("invalid_range", "A nutrition range requires source estimate.");
    const range = object(body.range);
    const low = externalValues(object(range.low));
    const high = externalValues(object(range.high));
    for (const key of Object.keys(nutrients) as (keyof ExternalNutrition)[]) {
      if (low[key] > result[key] || high[key] < result[key]) throw new AgentInputError("invalid_range", `Range must contain ${key}.`);
    }
    result.range = { low, high };
  }
  return result;
}

export function agentDate(value: unknown, today = todayLA()) {
  if (typeof value !== "string" || !isDay(value) || value > today || value.slice(0, 4) === "0000") {
    throw new AgentInputError("invalid_date", "Use YYYY-MM-DD in America/Los_Angeles. Future dates are unavailable.");
  }
  return value;
}

function agentMeal(value: unknown) {
  if (typeof value !== "string" || !(MEALS as readonly string[]).includes(value)) throw new AgentInputError("invalid_meal", "Use breakfast, lunch, dinner or snack.");
  return value as Meal;
}

export function normalizeAgentBatch(value: unknown, today = todayLA()) {
  const body = object(value);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 24) {
    throw new AgentInputError("invalid_items", "Submit 1–24 food items.");
  }
  const kind = body.input_type ?? "text";
  if (kind !== "photo" && kind !== "text") throw new AgentInputError("invalid_input_type", "Use text or photo.");
  const items = body.items.map(normalizeAgentFood);
  if (kind === "photo" && items.some((item) => item.source !== "estimate")) {
    throw new AgentInputError("photo_requires_estimates", "Use source estimate for photo results.");
  }
  return {
    date: agentDate(body.date ?? today, today), meal: agentMeal(body.meal), items, input_type: kind,
    preview: body.preview === true, confirmed: body.confirmed === true, allow_duplicate: body.allow_duplicate === true,
  };
}

export function normalizeAgentUpdate(value: unknown, today = todayLA()) {
  const body = object(value);
  return {
    item: normalizeAgentFood(body.item),
    ...(body.date == null ? {} : { date: agentDate(body.date, today) }),
    ...(body.meal == null ? {} : { meal: agentMeal(body.meal) }),
  };
}

// Training entries use the same shape and safe limits as the website form.
function workoutMuscle(value: unknown): Muscle {
  const muscle = MUSCLES.find((choice) => choice === value);
  if (!muscle) throw new AgentInputError("invalid_muscle", "Use chest, back, shoulders, legs, arms or core.");
  return muscle;
}

function workoutArray(value: unknown, max: number, field: string) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw new AgentInputError("invalid_field", `Invalid ${field}.`);
  return value;
}

function workoutInteger(value: unknown, max: number, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new AgentInputError("invalid_field", `Invalid ${field}.`);
  return valueIn(value, 1, max, field);
}

export function normalizeAgentWorkout(value: unknown, today = todayLA()) {
  const body = object(value);
  const kind = WORKOUT_KINDS.find((choice) => choice === body.kind);
  if (!kind) throw new AgentInputError("invalid_workout_kind", "Use strength, basketball, incline, treadmill or other.");
  const muscles = [...new Set(workoutArray(body.muscles, 6, "muscles").map(workoutMuscle))];
  const exercises: Exercise[] = workoutArray(body.exercises, 30, "exercises").map((value) => {
    const move = object(value);
    if (move.unit !== "lb" && move.unit !== "kg") throw new AgentInputError("invalid_unit", "Use lb or kg for exercise weights.");
    return { name: text(move.name, "name", 70), muscle: workoutMuscle(move.muscle),
      weight: valueIn(move.weight, 0, 2500, "weight"), unit: move.unit,
      sets: workoutInteger(move.sets, 100, "sets"), reps: workoutInteger(move.reps, 300, "reps") };
  });
  const hasStrengthDetails = muscles.length > 0 || exercises.length > 0;
  if ((kind === "strength") !== hasStrengthDetails) {
    throw new AgentInputError("invalid_workout_details", "Strength requires at least one muscle group or exercise. Cardio takes minutes and notes.");
  }
  return { date: agentDate(body.date ?? today, today), kind, muscles, exercises,
    minutes: body.minutes == null ? null : workoutInteger(body.minutes, 600, "minutes"),
    note: body.note == null ? "" : text(body.note, "note", 500, true) };
}

export function agentRevision(header: string | null) {
  const match = /^"?(\d{1,10})"?$/.exec(header ?? "");
  if (!match || match[0].startsWith('"') !== match[0].endsWith('"') || Number(match[1]) < 1 || Number(match[1]) > 2_147_483_646) {
    throw new AgentInputError("if_match_required", "Supply If-Match with the revision returned by GET.", 428);
  }
  return Number(match[1]);
}

function convert(values: Nutrition): ExternalNutrition {
  return { kcal: round(values.kcal, 2), protein_g: round(values.protein, 2), carbs_g: round(values.carbs, 2), fat_g: round(values.fat, 2) };
}

export function apiFoodRow({ id, revision, payload }: { id?: string; revision?: number; payload: FoodLog }) {
  const macros = foodTotals(payload);
  return {
    ...(id ? { id, revision } : {}), date: payload.day, meal: payload.meal, name: payload.name,
    amount: payload.amount, unit: payload.unit, grams: payload.grams,
    ...(macros ? convert(macros.total) : {}),
    source: payload.spec?.source, ...(payload.spec?.fdcId ? { fdc_id: payload.spec.fdcId } : {}),
    estimated_portion: payload.estimatedPortion,
    ...(macros?.bounds ? { range: { low: convert(macros.bounds.low), high: convert(macros.bounds.high) } } : {}),
    note: payload.note,
  };
}
