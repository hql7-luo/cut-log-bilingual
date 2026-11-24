import { AGENT_TOKEN, IDEMPOTENCY_KEY, MAX_AGENT_BODY, AgentInputError, apiFoodRow } from "../lib/agent-contract.ts";
import { CLOUD_ENABLED, SUPABASE_KEY, SUPABASE_URL } from "../lib/public-config.ts";
import { json } from "./providers.ts";

export type AgentAction = "list" | "get" | "preview" | "create" | "update" | "delete" | "create_workout";

export function agentToken(request: Request) {
  if (!CLOUD_ENABLED || process.env.FITNESS_AGENT_ENABLED !== "1") throw new AgentInputError("agent_disabled", "The agent API is disabled.", 503);
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!/^Bearer\s+/i.test(request.headers.get("authorization") ?? "") || !AGENT_TOKEN.test(token)) {
    throw new AgentInputError("invalid_token", "Use a dedicated connector bearer token.", 401);
  }
  return token;
}

export function idempotency(request: Request) {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(key)) throw new AgentInputError("idempotency_key_required", "Supply Idempotency-Key with 16–128 URL-safe characters.");
  return key;
}

export async function agentBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_AGENT_BODY) throw new AgentInputError("body_too_large", "Request too large.", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_AGENT_BODY) throw new AgentInputError("body_too_large", "Request too large.", 413);
  try { return JSON.parse(raw); }
  catch { throw new AgentInputError("invalid_json", "Use a JSON object."); }
}

// The publishable key reaches a narrowly scoped RPC. PostgreSQL checks token, owner, quotas and revision.
export async function runAgent(token: string, action: AgentAction, document: unknown, key?: string) {
  try {
    const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/fitness_agent_request", {
      method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token, p_action: action, p_document: document, p_key: key ?? null }),
      cache: "no-store", signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    if (!response.ok) throw new Error("database_error");
    const data = await response.json();
    const status = Number(data?.status);
    if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error("invalid_db_response");
    const { status: _status, rows, ...rest } = data;
    const items = Array.isArray(rows) ? rows.map(apiFoodRow) : undefined;
    return { status, data: { ...rest, ...(items ? { items } : {}) } };
  } catch { return { status: 503, data: { error: "agent_service_unavailable" } }; }
}

export async function agentResponse(handler: () => Promise<{ status: number; data: Record<string, unknown> }>) {
  try {
    const result = await handler();
    return json(result.data, result.status);
  } catch (failure) {
    if (failure instanceof AgentInputError) return json({ error: failure.code, message: failure.message }, failure.status);
    return json({ error: "agent_service_unavailable" }, 503);
  }
}
