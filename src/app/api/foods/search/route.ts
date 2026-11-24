import { authorizeProvider, json } from "../../../../server/providers.ts";
import { usdaResult, USDA_TYPES } from "../../../../server/usda.ts";
import type { FoodSpec } from "../../../../lib/model.ts";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 110) return json({ error: "请输入 2–110 个字符。" }, 400);
  const refused = await authorizeProvider(request, "usda");
  if (refused) return refused;
  try {
    const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
    url.searchParams.set("api_key", process.env.USDA_API_KEY!.trim());
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, pageSize: 16, dataType: USDA_TYPES }),
      signal: AbortSignal.timeout(9500), cache: "no-store",
    });
    if (!response.ok) return json({ error: "USDA 查询暂不可用，请使用食物库或包装标签。" }, 502);
    const data = await response.json();
    const results: FoodSpec[] = Array.isArray(data.foods)
      ? data.foods.map(usdaResult).filter((food: FoodSpec | null): food is FoodSpec => food !== null).slice(0, 10) : [];
    return json({ foods: results });
  } catch { return json({ error: "USDA 查询暂不可用，请稍后再试。" }, 502); }
}
