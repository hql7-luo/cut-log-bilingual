import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

// Local MCP bridge. The credential comes from the client's secure environment.
const token = process.env.CUT_LOG_TOKEN;
let origin;
try {
  const url = new URL(process.env.CUT_LOG_URL);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error();
  origin = url.origin;
} catch {
  console.error("Set CUT_LOG_URL to the deployed HTTPS origin.");
  process.exit(1);
}
if (!/^cut_[A-Za-z0-9_-]{43}$/.test(token ?? "")) {
  console.error("Set CUT_LOG_TOKEN to a dedicated connector token.");
  process.exit(1);
}
const { components } = JSON.parse(readFileSync(new URL("../public/food-records.openapi.json", import.meta.url), "utf8"));
function expand(schema) {
  if (Array.isArray(schema)) return schema.map(expand);
  if (!schema || typeof schema !== "object") return schema;
  if (schema.$ref) return expand(components.schemas[schema.$ref.split("/").at(-1)]);
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, expand(value)]));
}

const id = { type: "string", pattern: "^[A-Za-z0-9_-]{1,80}$" };
const key = { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" };
const revision = { type: "integer", minimum: 1 };
const shape = (properties, required = []) => ({ type: "object", properties, required });
const tools = [
  { name: "list_food_records", description: "List one Los Angeles calendar day's food records.", annotations: { readOnlyHint: true },
    inputSchema: shape({ date: { type: "string", format: "date" }, cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }) },
  { name: "get_food_record", description: "Read an item and its current revision.", annotations: { readOnlyHint: true }, inputSchema: shape({ id }, ["id"]) },
  { name: "save_food_batch", description: "Preview or save a batch. Photo: use preview first, show the result to the user, and obtain confirmation before saving the same batch and key.",
    annotations: { idempotentHint: true }, inputSchema: shape({ idempotency_key: key, batch: expand(components.schemas.FoodBatch) }, ["idempotency_key", "batch"]) },
  { name: "update_food_record", description: "Update one confirmed item using its latest revision and a stable retry key.",
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: shape({ id, revision, idempotency_key: key, update: expand(components.schemas.FoodUpdate) }, ["id", "revision", "idempotency_key", "update"]) },
  { name: "delete_food_record", description: "Delete an item after the user approves, using its current revision.",
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: shape({ id, revision, idempotency_key: key }, ["id", "revision", "idempotency_key"]) },
];

async function call(name, args) {
  const endpoint = new URL("/api/v1/food-records", origin);
  const headers = { Authorization: `Bearer ${token}` };
  let method = "GET";
  let body;
  if (name === "list_food_records") {
    for (const field of ["date", "limit", "cursor"]) if (args[field] != null) endpoint.searchParams.set(field, String(args[field]));
  } else if (name === "save_food_batch") {
    method = "POST";
    body = args.batch;
  } else if (["get_food_record", "update_food_record", "delete_food_record"].includes(name)) {
    if (typeof args.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(args.id)) throw new Error("Use a valid food record ID.");
    endpoint.pathname += "/" + args.id;
    if (name === "update_food_record") { method = "PATCH"; body = args.update; }
    if (name === "delete_food_record") method = "DELETE";
    if (method !== "GET") headers["If-Match"] = String(args.revision ?? "");
  } else throw new Error("Unknown tool");
  if (method !== "GET") headers["Idempotency-Key"] = String(args.idempotency_key ?? "");
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(endpoint, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(18_000), redirect: "error",
    });
    const data = await response.json();
    return { content: [{ type: "text", text: JSON.stringify(data) }], isError: !response.ok };
  } catch { return { content: [{ type: "text", text: "The food API is unavailable." }], isError: true }; }
}

const versions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const answer = (id, data) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, ...data }) + "\n");
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (line.length > 50_000) { answer(null, { error: { code: -32600, message: "Request too large" } }); continue; }
  let message;
  try { message = JSON.parse(line); } catch { answer(null, { error: { code: -32700, message: "Parse error" } }); continue; }
  if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") {
    answer(message?.id ?? null, { error: { code: -32600, message: "Invalid request" } }); continue;
  }
  if (!Object.hasOwn(message, "id")) continue;
  const { id, method, params } = message;
  try {
    if (method === "initialize") answer(id, { result: {
      protocolVersion: versions.includes(params?.protocolVersion) ? params.protocolVersion : versions[0],
      capabilities: { tools: {} }, serverInfo: { name: "cut-log", version: "1.0.0" },
    } });
    else if (method === "ping") answer(id, { result: {} });
    else if (method === "tools/list") answer(id, { result: { tools } });
    else if (method === "tools/call") answer(id, { result: await call(params?.name, params?.arguments ?? {}) });
    else answer(id, { error: { code: -32601, message: "Method not found" } });
  } catch (error) { answer(id, { error: { code: -32602, message: error.message } }); }
}
