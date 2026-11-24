// Shared records and configurable targets.
export const ACTIVITIES = ["rest", "strength", "basketball", "both"] as const;
export type Activity = typeof ACTIVITIES[number];
export const ACTIVITY_LABELS: Record<Activity, string> = {
  rest: "休息", strength: "力量", basketball: "篮球", both: "力量 + 篮球",
};

export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Meal = typeof MEALS[number];
export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐",
};

export const MUSCLES = ["chest", "back", "shoulders", "legs", "arms", "core"] as const;
export type Muscle = typeof MUSCLES[number];
export const MUSCLE_LABELS: Record<Muscle, string> = {
  chest: "胸", back: "背", shoulders: "肩", legs: "腿", arms: "手臂", core: "核心",
};

export const WORKOUT_KINDS = ["strength", "basketball", "incline", "treadmill", "other"] as const;
export type WorkoutKind = typeof WORKOUT_KINDS[number];
export const WORKOUT_LABELS: Record<WorkoutKind, string> = {
  strength: "力量训练", basketball: "篮球", incline: "跑步机爬坡", treadmill: "跑步机", other: "其他有氧",
};

export const ACTIVITY_LEVELS = {
  low: { label: "久坐 · 很少训练", factor: 1.2 },
  light: { label: "轻度 · 平日步数低", factor: 1.375 },
  moderate: { label: "中度 · 经常训练", factor: 1.55 },
  high: { label: "高度 · 日常活动多", factor: 1.725 },
};

export type Nutrition = { kcal: number; protein: number; carbs: number; fat: number };
export type Bounds = { low: Nutrition; high: Nutrition };
export type FoodSource = "usda-reference" | "usda-live" | "estimate" | "label" | "manual";
export type FoodSpec = {
  name: string;
  aliases: string[];
  category: "主食" | "蛋白质" | "蔬果" | "餐馆" | "补剂" | "其他";
  source: FoodSource;
  base: Nutrition;
  basisGrams: number | null;
  defaultUnit: string;
  defaultAmount: number;
  portions: Record<string, number>;
  bounds?: Bounds;
  fdcId?: number;
  note?: string;
};
export type FoodDraft = {
  name: string;
  spec: FoodSpec | null;
  amount: number;
  unit: string;
  grams: number | null;
  estimatedPortion: boolean;
  photoRange?: { low: number; high: number };
  note: string;
  lookup: string;
};
export type FoodLog = FoodDraft & { day: string; meal: Meal; time: number };
export type FoodPreset = { spec: FoodSpec; amount: number; unit: string; grams: number | null };

export type Exercise = {
  name: string;
  muscle: Muscle;
  weight: number;
  unit: "lb" | "kg";
  sets: number;
  reps: number;
};
export type Workout = {
  day: string;
  kind: WorkoutKind;
  exercises: Exercise[];
  muscles?: Muscle[];
  minutes: number | null;
  note: string;
  time: number;
};
export type WorkoutPreset = Pick<Workout, "kind" | "exercises" | "muscles" | "minutes" | "note"> & { name: string };

// A workout can name the muscle group before its exercise details are known.
export function workoutMuscles(workout: Workout): Muscle[] {
  return [...new Set([...(workout.muscles ?? []), ...workout.exercises.map(({ muscle }) => muscle)])];
}

export type Profile = {
  sex: "male" | "female";
  age: number | null;
  height: number;
  weight: number;
  goalWeight: number;
  goalDay: string;
  level: keyof typeof ACTIVITY_LEVELS;
  calories: Record<Activity, number>;
  protein: number;
  fat: number;
  paceMin: number;
  paceMax: number;
  handledReview?: string;
};

// The demo starts with illustrative targets. Real profiles are saved separately.
export const DEFAULT_PROFILE: Profile = {
  sex: "male",
  age: null,
  height: 175,
  weight: 75,
  goalWeight: 70,
  goalDay: "",
  level: "light",
  calories: { rest: 1900, strength: 2050, basketball: 2200, both: 2350 },
  protein: 140,
  fat: 60,
  paceMin: 0.4,
  paceMax: 0.6,
};

export function dailyTarget(profile: Profile, activity: Activity): Nutrition {
  const kcal = profile.calories[activity];
  return {
    kcal, protein: profile.protein, fat: profile.fat,
    carbs: Math.max(0, (kcal - profile.protein * 4 - profile.fat * 9) / 4),
  };
}

export function energyEstimate(profile: Profile) {
  if (!profile.age) return null;
  const sexConstant = profile.sex === "male" ? 5 : -161;
  const bmr = 10 * profile.weight + 6.25 * profile.height - 5 * profile.age + sexConstant;
  return { bmr: Math.round(bmr), tdee: Math.round(bmr * ACTIVITY_LEVELS[profile.level].factor) };
}

export type Records = {
  profile: Profile;
  food: FoodLog;
  workout: Workout;
  weight: { day: string; kg: number };
  activity: { day: string; activity: Activity };
  food_preset: FoodPreset;
  workout_preset: WorkoutPreset;
};
export type RecordKind = keyof Records;

export type Change<K extends RecordKind = RecordKind> = {
  kind: K;
  id: string;
  payload: Records[K] | null;
  sample?: boolean;
};

export type Row<K extends RecordKind = RecordKind> = Change<K> & {
  revision: number;
  cursor: number;
};
export type LogRow<K extends RecordKind> = Row<K> & { payload: Records[K] };

export function recordsOf<K extends RecordKind>(rows: Row[], kind: K): LogRow<K>[] {
  return rows.filter((row) => row.kind === kind && row.payload !== null) as LogRow<K>[];
}

export function rowKey(row: Pick<Row, "kind" | "id">) {
  return `${row.kind}:${row.id}`;
}

export function makeId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function activityFor(workouts: Workout[]): Activity {
  const strength = workouts.some((workout) => workout.kind === "strength");
  const basketball = workouts.some((workout) => workout.kind === "basketball");
  if (strength && basketball) return "both";
  if (strength) return "strength";
  return basketball ? "basketball" : "rest";
}
