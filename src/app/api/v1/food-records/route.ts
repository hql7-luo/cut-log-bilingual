import { AgentInputError, agentDate, FOOD_ID, normalizeAgentBatch } from "../../../../lib/agent-contract.ts";
import { todayLA } from "../../../../lib/dates.ts";
import { agentBody, agentResponse, agentToken, idempotency, runAgent } from "../../../../server/agent-api.ts";

export function GET(request: Request) {
  return agentResponse(async () => {
    const token = agentToken(request);
    const query = new URL(request.url).searchParams;
    const date = agentDate(query.get("date") ?? todayLA());
    const cursor = query.get("cursor");
    const limit = query.get("limit") ?? "50";
    if (cursor && !FOOD_ID.test(cursor)) throw new AgentInputError("invalid_cursor", "Use next_cursor from the previous page.");
    if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) {
      throw new AgentInputError("invalid_limit", "Limit must be between 1 and 100.");
    }
    return runAgent(token, "list", { date, limit: Number(limit), after: cursor ?? "" });
  });
}

export function POST(request: Request) {
  return agentResponse(async () => {
    const token = agentToken(request);
    const key = idempotency(request);
    const batch = normalizeAgentBatch(await agentBody(request));
    return runAgent(token, batch.preview ? "preview" : "create", batch, key);
  });
}
