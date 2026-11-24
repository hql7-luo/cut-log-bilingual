import type { Bounds, FoodDraft, FoodSpec, Nutrition } from "./model.ts";
import { translate, type Language } from "./locale.ts";

// Nutrition always scales from a known reference or the user's confirmed totals.
export const ZERO: Nutrition = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
export const MACROS = ["protein", "carbs", "fat"] as const;
export const NUTRIENTS = ["kcal", ...MACROS] as const;
export const NUTRIENT_LABEL = { kcal: "热量", protein: "蛋白质", carbs: "碳水", fat: "脂肪" };

export function nutrition(kcal: number, protein: number, carbs: number, fat: number): Nutrition {
  return { kcal, protein, carbs, fat };
}
export function scale(value: Nutrition, factor: number): Nutrition {
  return nutrition(value.kcal * factor, value.protein * factor, value.carbs * factor, value.fat * factor);
}
export function sum(entries: Nutrition[]): Nutrition {
  return entries.reduce((total, entry) => nutrition(
    total.kcal + entry.kcal, total.protein + entry.protein, total.carbs + entry.carbs, total.fat + entry.fat,
  ), ZERO);
}
export function round(value: number, places = 1) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
export const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
export const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const WEIGHT_UNITS: Record<string, number> = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
export function weightInGrams(amount: number, unit: string) {
  return Object.hasOwn(WEIGHT_UNITS, unit) ? amount * WEIGHT_UNITS[unit] : null;
}

export function portionGrams(spec: FoodSpec, amount: number, unit: string) {
  if (Object.hasOwn(spec.portions, unit)) return spec.portions[unit] * amount;
  if (unit === "份" && spec.basisGrams !== 100) return spec.basisGrams === null ? null : spec.basisGrams * amount;
  return null;
}

export function fromSpec(spec: FoodSpec, amount = spec.defaultAmount, unit = spec.defaultUnit): FoodDraft {
  const weighed = weightInGrams(amount, unit);
  return {
    name: spec.name, spec, amount, unit, grams: weighed ?? portionGrams(spec, amount, unit),
    estimatedPortion: weighed === null && spec.source !== "label" && unit !== "份",
    note: "", lookup: "",
  };
}

export function foodTotals(entry: FoodDraft): { total: Nutrition; bounds?: Bounds } | null {
  const { spec, grams, unit, amount } = entry;
  if (!spec || !Number.isFinite(amount) || amount <= 0 || amount > 10_000) return null;
  let multiplier: number;
  if (spec.basisGrams !== null) {
    const mass = grams ?? weightInGrams(amount, unit) ?? portionGrams(spec, amount, unit);
    if (mass === null || !Number.isFinite(mass) || mass <= 0 || mass > 20_000) return null;
    multiplier = mass / spec.basisGrams;
  } else {
    if (unit !== spec.defaultUnit && unit !== "份") return null;
    multiplier = amount / spec.defaultAmount;
  }
  const total = scale(spec.base, multiplier);
  if (Object.values(total).some((value) => !Number.isFinite(value) || value < 0)) return null;
  const photo = entry.photoRange;
  const bounds = photo && spec.basisGrams !== null
    ? { low: scale(spec.bounds?.low ?? spec.base, photo.low / spec.basisGrams),
        high: scale(spec.bounds?.high ?? spec.base, photo.high / spec.basisGrams) }
    : spec.bounds && { low: scale(spec.bounds.low, multiplier), high: scale(spec.bounds.high, multiplier) };
  return { total, bounds };
}

export function portionText(entry: FoodDraft, language: Language = "zh") {
  const amount = number.format(entry.amount);
  const label = translate(language, entry.unit);
  const plural = language === "en" && label !== entry.unit && entry.amount !== 1 && label !== "tsp" && label !== "tbsp";
  const spaced = language === "en" || /^[a-z]+$/i.test(entry.unit) ? " " : "";
  const grams = entry.grams === null || entry.unit === "g" ? "" :
    ` · ${entry.estimatedPortion ? translate(language, "约 ") : ""}${number.format(entry.grams)} g`;
  return `${amount}${spaced}${label}${plural ? "s" : ""}${grams}`;
}

export function sourceLabel(entry: FoodDraft) {
  const labels = { "usda-reference": "USDA 参考", "usda-live": "USDA 在线", estimate: "估算", label: "包装标签", manual: "手动确认" };
  return entry.spec ? labels[entry.spec.source] : "待确认";
}

export function fdcLink(id: number) {
  return `https://fdc.nal.usda.gov/food-details/${id}/nutrients`;
}

export function normalize(text: string) {
  return text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}
