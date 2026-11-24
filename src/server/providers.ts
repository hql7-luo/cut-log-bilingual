import { CLOUD_ENABLED, SUPABASE_KEY, SUPABASE_URL } from "../lib/public-config.ts";

export const providerFlags = () => ({
  vision: Boolean(CLOUD_ENABLED && process.env.AI_API_KEY?.trim() && process.env.AI_VISION_MODEL?.trim()),
  ai: Boolean(CLOUD_ENABLED && process.env.AI_API_KEY?.trim() && process.env.AI_MODEL?.trim()),
  usda: Boolean(CLOUD_ENABLED && process.env.USDA_API_KEY?.trim()),
});

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

// Check the authenticated user and shared database quota before using a server key.
export async function authorizeProvider(request: Request, provider: "ai" | "usda" | "vision") {
  if (!providerFlags()[provider]) return json({ error: "此服务尚未配置。" }, 503);
  const token = request.headers.get("authorization");
  if (!token || !/^Bearer [A-Za-z0-9._-]{20,5000}$/.test(token)) return json({ error: "请先登录账号。" }, 401);
  try {
    const headers = { apikey: SUPABASE_KEY, Authorization: token };
    const userRequest = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers, signal: AbortSignal.timeout(7000), cache: "no-store",
    });
    if (!userRequest.ok) return json({ error: "请重新登录账号。" }, 401);
    const user = await userRequest.json();
    const owner = process.env.FITNESS_ALLOWED_EMAIL?.toLowerCase().trim();
    if (!user.id || typeof user.email !== "string" || !user.email_confirmed_at ||
      (owner && user.email.toLowerCase() !== owner)) {
      return json({ error: "此账号未获在线服务权限。" }, 403);
    }
    const allowance = await fetch(SUPABASE_URL + "/rest/v1/rpc/use_fitness_provider", {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_provider: provider === "vision" ? "ai" : provider }), signal: AbortSignal.timeout(7000), cache: "no-store",
    });
    if (!allowance.ok) return json({ error: "云端在线服务尚未准备好。" }, 503);
    if (await allowance.json() !== true) return json({ error: "本小时已用完在线查询额度。" }, 429);
    return null;
  } catch { return json({ error: "暂时无法确认账号，请稍后重试。" }, 503); }
}
