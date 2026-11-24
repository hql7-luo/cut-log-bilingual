import type { FoodSpec } from "../lib/model.ts";
import { nutrition } from "../lib/nutrition.ts";

type Nutrient = { nutrientId?: number; nutrientNumber?: string; unitName?: string; value?: number };
type Result = { fdcId?: number; description?: string; dataType?: string; foodNutrients?: Nutrient[] };

// Only complete, mass-based USDA results can become selectable nutrition sources.
export const USDA_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)"];
export function usdaResult(food: Result): FoodSpec | null {
  if (!food || !Number.isInteger(food.fdcId) || Number(food.fdcId) <= 0 ||
      typeof food.description !== "string" || !food.description.trim() ||
      !USDA_TYPES.includes(food.dataType ?? "") || !Array.isArray(food.foodNutrients)) return null;
  const find = (ids: number[], code: string, unit: string) => {
    for (const id of ids) {
      const match = food.foodNutrients?.find((n) => n?.nutrientId === id && n.unitName?.toUpperCase() === unit
        && typeof n.value === "number" && Number.isFinite(n.value) && n.value >= 0);
      if (match) return match.value;
    }
    return food.foodNutrients?.find((n) => n?.nutrientNumber === code && n.unitName?.toUpperCase() === unit
      && typeof n.value === "number" && Number.isFinite(n.value) && n.value >= 0)?.value;
  };
  const kcal = find([1008, 2048, 2047], "208", "KCAL");
  const protein = find([1003], "203", "G");
  const carbs = find([1005], "205", "G");
  const fat = find([1004], "204", "G");
  if (kcal === undefined || protein === undefined || carbs === undefined || fat === undefined) return null;
  return {
    name: food.description.slice(0, 140), aliases: [], category: "其他", source: "usda-live",
    basisGrams: 100, defaultAmount: 100, defaultUnit: "g", portions: {}, fdcId: food.fdcId,
    base: nutrition(kcal, protein, carbs, fat),
    note: `USDA ${food.dataType}，每 100 g。请核对生熟与名称。`,
  };
}
