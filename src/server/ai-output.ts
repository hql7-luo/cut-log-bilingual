import type { ParsedFood } from "../lib/parse-food.ts";

function positive(value: unknown, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum ? value : null;
}

// Provider output carries names and quantities only. It is never a nutrition source.
export function parseProviderItems(content: unknown): ParsedFood[] {
  if (typeof content !== "string" || content.length > 20_000) return [];
  const cleaned = content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  try {
    const value = JSON.parse(cleaned);
    if (!Array.isArray(value?.items)) return [];
    return value.items.slice(0, 24).flatMap((item: Record<string, unknown> | null) => {
      if (typeof item?.name !== "string" || !item.name.trim()) return [];
      const low = positive(item.lowGrams, 20_000);
      const high = positive(item.highGrams, 20_000);
      const grams = positive(item.grams, 20_000);
      return [{
        name: item.name.trim().slice(0, 140),
        amount: positive(item.amount, 10_000),
        unit: typeof item.unit === "string" ? item.unit.trim().slice(0, 18) : "",
        grams,
        photoRange: low !== null && high !== null && grams !== null && low <= grams && high >= grams ? { low, high } : undefined,
        lookup: typeof item.lookup === "string" ? item.lookup.trim().slice(0, 110) : "",
        note: typeof item.note === "string" ? item.note.trim().slice(0, 160) : "",
      }];
    });
  } catch { return []; }
}
