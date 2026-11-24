import { normalizeAgentWorkout } from "../../../../lib/agent-contract.ts";
import { agentBody, agentResponse, agentToken, idempotency, runAgent } from "../../../../server/agent-api.ts";

// An authorized connector can append one workout per request.
export function POST(request: Request) {
  return agentResponse(async () => {
    const token = agentToken(request);
    const key = idempotency(request);
    const workout = normalizeAgentWorkout(await agentBody(request));
    return runAgent(token, "create_workout", workout, key);
  });
}
