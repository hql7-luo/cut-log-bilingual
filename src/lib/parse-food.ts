import { CATALOG, exactFood } from "./catalog.ts";
import { hourLA, shiftDay } from "./dates.ts";
import type { FoodDraft, FoodPreset, FoodSpec, Meal, Nutrition } from "./model.ts";
import { foodTotals, fromSpec, normalize, NUTRIENTS, portionGrams, weightInGrams, withNutritionTotals } from "./nutrition.ts";

// Parse household quantities, keeping the source phrase when nutrition is unknown.
const chinese: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const english: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 };
const NUMBER = "(?:\\d{1,5}/\\d{1,4}|\\d{1,5}(?:\\.\\d+)?|[零一二两三四五六七八九十百]+|半|(?:half|one|two|three|four|five|six|an|a)\\b)";
const UNIT = "(?:fl\\s?oz|kilograms?|kilogrammes?|grams?|ounces?|pounds?|tablespoons?|teaspoons?|portions?|servings?|scoops?|pieces?|sticks?|bowls?|cups?|slices?|tbsp|tsp|lbs?|ml|kg|oz|g|毫升|千克|公斤|克|大勺|茶匙|汤匙|碗|个|颗|份|勺|根|杯|盘|盒|瓶|块|片|袋)";
const amountAtStart = new RegExp(`^(?:大约|大概|大概有|约|about\\s+)?\\s*(${NUMBER})\\s*(${UNIT}(?![a-z]))?\\s*(半)?\\s*(?:of\\s+)?`, "i");
const amountAtEnd = new RegExp(`\\s*(${NUMBER})\\s*(${UNIT}(?![a-z]))\\s*(半)?$`, "i");

export function parseAmount(value: string): number {
  const input = value.toLowerCase();
  if (input === "半") return 0.5;
  if (Object.hasOwn(english, input)) return english[input];
  if (input.includes("/")) {
    const [top, bottom] = input.split("/").map(Number);
    return bottom > 0 ? top / bottom : NaN;
  }
  if (Number.isFinite(Number(input))) return Number(input);
  let total = 0;
  let digit = 0;
  for (const symbol of input) {
    if (symbol === "十" || symbol === "百") {
      total += (digit || 1) * (symbol === "十" ? 10 : 100);
      digit = 0;
    } else if (Object.hasOwn(chinese, symbol)) {
      digit = chinese[symbol];
    } else return NaN;
  }
  return total + digit;
}

export function normalizeUnit(value: string) {
  const unit = normalize(value);
  const mappings: [RegExp, string][] = [
    [/^(kg|千克|公斤|kilograms?|kilogrammes?)$/, "kg"], [/^(g|克|grams?)$/, "g"],
    [/^(oz|ounces?)$/, "oz"], [/^(lbs?|pounds?)$/, "lb"], [/^(ml|毫升)$/, "ml"],
    [/^(fl ?oz)$/, "fl oz"], [/^(碗|bowls?)$/, "碗"], [/^(份|servings?|portions?)$/, "份"],
    [/^(杯|cups?)$/, "杯"], [/^(勺|scoops?)$/, "勺"], [/^(大勺|汤匙|tbsp|tablespoons?)$/, "大勺"],
    [/^(茶匙|tsp|teaspoons?)$/, "茶匙"], [/^(个|pieces?)$/, "个"], [/^(片|slices?)$/, "片"],
  ];
  return mappings.find(([pattern]) => pattern.test(unit))?.[1] ?? unit.slice(0, 12);
}

const prefix = /^(?:\s*(?:我|今天|昨天|前天|今早|昨晚|刚刚|刚才|早上|早餐|早饭|上午|中午|午餐|午饭|下午|加餐|傍晚|晚上|晚餐|晚饭|夜宵|在外面|外面|训练后|练完|运动后|吃了|喝了|吃过|喝过|啃了|来了|外加|另外|还吃了|配了|加了)\s*[:：]?|\s*(?:i\s+|for breakfast\b|for lunch\b|for dinner\b|yesterday\b|today\b|this morning\b|i had\b|had\b|ate\b|drank\b|just\b)\s*)+/i;

function cleanName(text: string) {
  return text.replace(prefix, "").replace(/^[\s:：]+|[\s.!！?？。]+$/g, "").replace(/(?:了|而已)$/u, "").trim();
}

function splitPhrase(text: string) {
  return text.normalize("NFKC").split(/\r?\n|[、;；。!！?？]|,(?!\d{3}\b)|\s+(?:and|plus|with|&)\s+|以及|还有|外加|再加|加上|配了|搭配|和|跟/)
    .map(cleanName).filter(Boolean);
}

export type ParsedFood = {
  name: string;
  amount: number | null;
  unit: string;
  grams?: number | null;
  photoRange?: { low: number; high: number };
  lookup?: string;
  note?: string;
};

function parseClause(clause: string): ParsedFood {
  const atStart = amountAtStart.exec(clause);
  const atEnd = atStart ? null : amountAtEnd.exec(clause);
  const match = atStart ?? atEnd;
  if (!match) return { name: clause.slice(0, 140), amount: null, unit: "" };
  const name = cleanName(atStart ? clause.slice(match[0].length) : clause.slice(0, match.index));
  const amount = parseAmount(match[1]) + (match[3] ? 0.5 : 0);
  if (!name || !Number.isFinite(amount) || amount <= 0 || amount > 10_000) {
    return { name: clause.slice(0, 140), amount: null, unit: "", note: "请确认食物与份量。" };
  }
  return { name: name.slice(0, 140), amount, unit: normalizeUnit(match[2] ?? "") };
}

function compatibleSpec(name: string, all: FoodSpec[], unit: string) {
  const candidate = exactFood(name, all);
  if (!candidate || candidate.basisGrams !== null || !unit || unit === "份" || unit === candidate.defaultUnit) return candidate;
  return all.find((spec) => spec !== candidate && exactFood(name, [spec]) &&
    (spec.basisGrams !== null || unit === spec.defaultUnit)) ?? candidate;
}

export function resolveFood(item: ParsedFood, foods: FoodSpec[] = CATALOG, favorites: FoodPreset[] = []): FoodDraft {
  const unit = normalizeUnit(item.unit);
  const spec = compatibleSpec(item.name, foods, unit);
  const saved = item.amount === null && !item.grams ? favorites.find((preset) =>
    preset.spec === spec && (!unit || unit === preset.unit)) : undefined;
  if (saved) {
    return { ...fromSpec(saved.spec, saved.amount, saved.unit), grams: saved.grams, note: item.note ?? "", lookup: item.lookup ?? "" };
  }
  const quantity = item.amount ?? (item.grams ? item.grams : spec?.defaultAmount ?? 1);
  const chosenUnit = unit || (item.grams ? "g" : spec?.defaultUnit ?? "份");
  const explicitMass = weightInGrams(quantity, chosenUnit);
  if (!spec) {
    return {
      name: item.name, amount: quantity, unit: chosenUnit, grams: explicitMass ?? item.grams ?? null,
      estimatedPortion: item.amount === null || explicitMass === null, note: item.note || "请选择匹配的食物，或手动填写营养。",
      spec: null, lookup: item.lookup || item.name,
    };
  }
  const draft = fromSpec(spec, quantity, chosenUnit);
  if (explicitMass === null && item.grams && !draft.grams) draft.grams = item.grams;
  if (item.amount === null || (explicitMass === null && spec.source !== "label")) draft.estimatedPortion = true;
  draft.note = item.note || "";
  draft.lookup = item.lookup || "";
  return draft;
}

export function applyFoodChoice(entry: FoodDraft, spec: FoodSpec): FoodDraft {
  if (entry.spec) return fromSpec(spec);
  const match = fromSpec(spec, entry.amount, entry.unit);
  const grams = entry.grams ?? portionGrams(spec, entry.amount, entry.unit);
  if (grams === null && spec.basisGrams === null && entry.unit !== "份" && entry.unit !== spec.defaultUnit) {
    return { ...match, note: "请核对单位与标签份量。" };
  }
  const chosen = { ...match, grams, estimatedPortion: entry.estimatedPortion, note: "" };
  return entry.reportedNutrition ? applyReportedNutrition(chosen, entry.reportedNutrition) : chosen;
}

type ReportedNutrition = { unit?: string; values: Partial<Nutrition> };
const nutritionNumber = "(\\d{1,5}(?:\\.\\d+)?)";
const servingUnit = new RegExp("^(?:每\\s*|per\\s+)(" + UNIT + ")(?![a-z])\\s*[:：]?\\s*", "i");
const trailingServing = new RegExp("\\s+per\\s+(" + UNIT + ")(?![a-z])$", "i");
const inlineServing = new RegExp("(?:每\\s*|\\bper\\s+)" + UNIT + "(?![a-z])", "i");
const kcalEntry = new RegExp("(?:热量\\s*[:：]?\\s*)?" + nutritionNumber + "\\s*(?:kcal|calories?|cals?|卡路里|大卡|千卡|卡)(?![a-z])", "i");
const macroLabels = { protein: "蛋白质|蛋白|protein", carbs: "碳水化合物|碳水|carbohydrates?|carbs?", fat: "脂肪|fat" } as const;
const macroEntries = Object.entries(macroLabels).map(([key, label]) => ({
  key: key as keyof typeof macroLabels,
  pattern: new RegExp(nutritionNumber + "\\s*(?:克|grams?|g)\\s*(?:" + label + ")(?![a-z])|(?:" + label +
    ")\\s*[:：]?\\s*" + nutritionNumber + "\\s*(?:克|grams?|g)(?![a-z])", "i"),
}));

// A nutrition note can follow its food on the same line or after a comma.
function reportedNutrition(phrase: string): ReportedNutrition | null {
  const serving = servingUnit.exec(phrase);
  const trailing = serving ? null : trailingServing.exec(phrase);
  const values: Partial<Nutrition> = {};
  let rest = phrase.slice(serving?.[0].length ?? 0, trailing?.index).replace(/^含\s*/, "");
  rest = rest.replace(kcalEntry, (_, value) => { values.kcal = Number(value); return ""; });
  for (const { key, pattern } of macroEntries) {
    rest = rest.replace(pattern, (_, before, after) => { values[key] = Number(before ?? after); return ""; });
  }
  if (!Object.keys(values).length || !/^[\s:：,/]*$/.test(rest)) return null;
  const unit = serving?.[1] ?? trailing?.[1];
  return { values, unit: unit && normalizeUnit(unit) };
}

function applyReportedNutrition(food: FoodDraft, values: Partial<Nutrition>): FoodDraft {
  const reference = foodTotals(food)?.total;
  const total = { ...reference, ...values };
  if (NUTRIENTS.some((key) => total[key] === undefined)) {
    return { ...food, reportedNutrition: values, note: "已提取文字里的营养数值，请补齐其余项目。" };
  }
  return {
    ...withNutritionTotals(food, total as Nutrition), reportedNutrition: values, estimatedPortion: food.estimatedPortion,
    note: NUTRIENTS.every((key) => values[key] !== undefined) ? "营养按文字中的数值记录。" : "已采用文字中的营养数值，其余项目沿用食物参考。",
  };
}

function applyServingNutrition(food: FoodDraft, note: ReportedNutrition): FoodDraft {
  const { unit, values } = note;
  const gramsPerUnit = unit ? weightInGrams(1, unit) ?? (food.spec && portionGrams(food.spec, 1, unit)) : null;
  const multiplier = !unit ? 1 : unit === food.unit ? food.amount :
    gramsPerUnit && food.grams ? food.grams / gramsPerUnit : null;
  if (multiplier === null) return { ...food, note: "请核对文字中的每份营养和记录单位。" };
  const totals: Partial<Nutrition> = {};
  for (const key of NUTRIENTS) {
    const value = values[key];
    if (value !== undefined) totals[key] = value * multiplier;
  }
  return applyReportedNutrition(food, totals);
}

export function parseLocal(text: string, foods: FoodSpec[] = CATALOG, favorites: FoodPreset[] = []): FoodDraft[] {
  const entries: { food: string; note: ReportedNutrition | null }[] = [];
  for (const phrase of splitPhrase(text)) {
    const note = reportedNutrition(phrase);
    if (note) {
      const previous = entries.at(-1);
      if (previous) {
        const inherited = previous.note;
        const sameUnit = !note.unit || !inherited?.unit || note.unit === inherited.unit;
        previous.note = { unit: note.unit ?? inherited?.unit, values: { ...(sameUnit && inherited?.values), ...note.values } };
      }
      continue;
    }
    const servingIndex = phrase.search(inlineServing);
    const noteIndex = servingIndex > 0 ? servingIndex : phrase.search(kcalEntry);
    const inline = noteIndex > 0 ? reportedNutrition(phrase.slice(noteIndex)) : null;
    entries.push({ food: inline ? phrase.slice(0, noteIndex) : phrase, note: inline });
  }
  return entries.slice(0, 24).map(({ food, note }) => {
    const draft = resolveFood(parseClause(cleanName(food)), foods, favorites);
    return note ? applyServingNutrition(draft, note) : draft;
  });
}

export function inferMeal(text: string, now = new Date(), selected?: Meal): Meal {
  if (/早餐|早饭|今早|早上|breakfast/i.test(text)) return "breakfast";
  if (/午餐|午饭|中午|\blunch\b/i.test(text)) return "lunch";
  if (/晚餐|晚饭|晚上|昨晚|\bdinner\b/i.test(text)) return "dinner";
  if (/加餐|训练后|练完|夜宵|\bsnack\b/i.test(text)) return "snack";
  if (selected) return selected;
  const hour = hourLA(now);
  if (hour >= 5 && hour < 10) return "breakfast";
  if (hour >= 10 && hour < 14) return "lunch";
  return hour >= 17 && hour < 21 ? "dinner" : "snack";
}

export function inferDay(text: string, today: string, selected: string) {
  const leading = text.trim().slice(0, 45);
  if (/^(?:我\s*)?(前天|the day before yesterday)/i.test(leading)) return shiftDay(today, -2);
  if (/^(?:我\s*)?(昨天|昨晚|yesterday)/i.test(leading)) return shiftDay(today, -1);
  if (/^(?:我\s*)?(今天|今早|today)/i.test(leading)) return today;
  return selected;
}
