import { AgentInputError, agentRevision, FOOD_ID, normalizeAgentUpdate } from "../../../../../lib/agent-contract.ts";
import { agentBody, agentResponse, agentToken, idempotency, runAgent } from "../../../../../server/agent-api.ts";

type RouteContext = { params: Promise<{ id: string }> };

async function foodId(context: RouteContext) {
  const { id } = await context.params;
  if (!FOOD_ID.test(id)) throw new AgentInputError("invalid_id", "Use the ID returned by the API.");
  return id;
}

export function GET(request: Request, context: RouteContext) {
  return agentResponse(async () => runAgent(agentToken(request), "get", { id: await foodId(context) }));
}

export function PATCH(request: Request, context: RouteContext) {
  return agentResponse(async () => {
    const token = agentToken(request);
    const key = idempotency(request);
    const revision = agentRevision(request.headers.get("if-match"));
    const update = normalizeAgentUpdate(await agentBody(request));
    return runAgent(token, "update", { id: await foodId(context), revision, ...update }, key);
  });
}

export function DELETE(request: Request, context: RouteContext) {
  return agentResponse(async () => {
    const token = agentToken(request);
    const key = idempotency(request);
    const revision = agentRevision(request.headers.get("if-match"));
    return runAgent(token, "delete", { id: await foodId(context), revision }, key);
  });
}
