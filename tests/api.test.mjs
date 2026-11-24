import assert from "node:assert/strict";
import test from "node:test";
import { parseLocal } from "../src/lib/parse-food.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-test-key";
process.env.FITNESS_AGENT_ENABLED = "1";
process.env.AI_BASE_URL = "https://ai-provider.test/v1";
process.env.AI_API_KEY = "server-test-key";
process.env.AI_MODEL = "text-test";
process.env.AI_VISION_MODEL = "photo-test";
process.env.USDA_API_KEY = "usda-test-key";
const { POST, GET } = await import("../src/app/api/v1/food-records/route.ts");
const itemApi = await import("../src/app/api/v1/food-records/[id]/route.ts");
const workoutApi = await import("../src/app/api/v1/workouts/route.ts");
const parse = await import("../src/app/api/foods/parse/route.ts");
const photo = await import("../src/app/api/foods/photo/route.ts");
const usda = await import("../src/app/api/foods/search/route.ts");

const date = "2026-01-10";
const base = "https://tracker.test/api/v1/food-records";
const token = "cut_" + "a".repeat(43);
const mutation = "meal-request-test-01";
const example = { name: "白米饭", amount: 150, unit: "g", kcal: 195, protein_g: 4, carbs_g: 42, fat_g: 0.4 };
const food = { ...parseLocal("150g 米饭")[0], day: date, meal: "lunch", time: 100 };
const row = { id: "food-a", revision: 1, payload: food };
const agentHeaders = { Authorization: `Bearer ${token}`, "Idempotency-Key": mutation };

test("agent REST uses only the scoped RPC, preserves batch retry keys, and enforces revisions", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "https://supabase.test/rest/v1/rpc/fitness_agent_request");
    assert.equal(options.headers.apikey, "public-test-key");
    assert.equal(options.headers.Authorization, undefined);
    const received = JSON.parse(options.body);
    assert.equal(received.p_token, token);
    calls.push(received);
    const replay = calls.filter(({ p_action }) => p_action === "create").length > 1;
    if (received.p_action === "preview") return Response.json({ status: 200, preview: true, rows: [{ payload: food }] });
    if (received.p_action === "create") return Response.json({ status: replay ? 200 : 201, replayed: replay, rows: [row] });
    if (received.p_action === "delete") return Response.json({ status: 200, deleted: row.id, revision: 2 });
    return Response.json({ status: 200, rows: [row], next_cursor: null });
  });

  assert.equal((await GET(new Request(base))).status, 401);
  assert.equal((await POST(new Request(base, { method: "POST", headers: { Authorization: agentHeaders.Authorization }, body: "{}" }))).status, 400);
  const batch = { date, meal: "lunch", items: [example, example], input_type: "photo" };
  const post = (data) => POST(new Request(base, { method: "POST", headers: agentHeaders, body: JSON.stringify(data) }));
  const preview = await (await post({ ...batch, preview: true })).json();
  assert.equal(preview.preview, true);
  assert.equal(preview.items[0].id, undefined);
  const save = await post({ ...batch, confirmed: true });
  assert.equal(save.status, 201);
  assert.equal((await save.json()).items[0].id, "food-a");
  assert.equal((await (await post({ ...batch, confirmed: true })).json()).replayed, true);
  assert.deepEqual(calls.slice(0, 3).map(({ p_action, p_key }) => [p_action, p_key]), [
    ["preview", mutation], ["create", mutation], ["create", mutation],
  ]);
  assert.equal(calls[1].p_document.items.length, 2);
  assert.equal(calls[1].p_document.confirmed, true);
  const list = await GET(new Request(base + `?date=${date}&limit=5`, { headers: agentHeaders }));
  assert.equal((await list.json()).items[0].grams, 150);
  assert.equal(calls.at(-1).p_document.limit, 5);

  const context = { params: Promise.resolve({ id: "food-a" }) };
  const update = { method: "PATCH", headers: agentHeaders, body: JSON.stringify({ item: example }) };
  assert.equal((await itemApi.PATCH(new Request(base + "/food-a", update), context)).status, 428);
  const headers = { ...agentHeaders, "If-Match": '"1"' };
  assert.equal((await itemApi.PATCH(new Request(base + "/food-a", { ...update, headers }), context)).status, 200);
  assert.equal(calls.at(-1).p_document.revision, 1);
  assert.equal((await (await itemApi.DELETE(new Request(base + "/food-a", { method: "DELETE", headers }), context)).json()).deleted, row.id);
});

test("workout creation accepts a muscle-only summary and preserves a retry key", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "https://supabase.test/rest/v1/rpc/fitness_agent_request");
    const received = JSON.parse(options.body);
    assert.equal(received.p_action, "create_workout");
    calls.push(received);
    return Response.json({ status: calls.length > 1 ? 200 : 201, id: "workout-a", date,
      kind: "strength", ...(calls.length > 1 ? { replayed: true } : {}) });
  });
  const request = (body, headers = agentHeaders) => new Request("https://tracker.test/api/v1/workouts", {
    method: "POST", headers, body: JSON.stringify(body),
  });
  assert.equal((await workoutApi.POST(request({}, {}))).status, 401);
  assert.equal((await workoutApi.POST(request({ date, kind: "strength" }))).status, 400);
  assert.equal((await workoutApi.POST(request({ date, kind: "basketball", minutes: 20.5 }))).status, 400);
  const workout = { date, kind: "strength", muscles: ["chest"] };
  assert.equal((await workoutApi.POST(request(workout))).status, 201);
  const replay = await workoutApi.POST(request(workout));
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].p_key, mutation);
  assert.deepEqual(calls[0].p_document, {
    ...workout, exercises: [], minutes: null, note: "",
  });
});

test("text, photo and USDA require an authenticated permitted account, and keep provider keys on the server", async (t) => {
  const jwt = "Bearer " + "a".repeat(45);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    calls.push(url.hostname + url.pathname);
    if (url.hostname === "supabase.test") {
      assert.equal(options.headers.Authorization, jwt);
      if (url.pathname.endsWith("/user")) return Response.json({ id: "test-user", email: "test@example.com", email_confirmed_at: date });
      return Response.json(true);
    }
    if (url.hostname === "api.nal.usda.gov") {
      assert.equal(url.searchParams.get("api_key"), "usda-test-key");
      const valid = { fdcId: 168878, description: "Rice, cooked", dataType: "SR Legacy", foodNutrients: [
        { nutrientId: 1008, unitName: "KCAL", value: 130 }, { nutrientId: 1003, unitName: "G", value: 2.69 },
        { nutrientId: 1005, unitName: "G", value: 28.17 }, { nutrientId: 1004, unitName: "G", value: 0.28 },
      ] };
      return Response.json({ foods: [valid, { ...valid, fdcId: 9, foodNutrients: [] }] });
    }
    assert.equal(url.hostname, "ai-provider.test");
    assert.equal(options.headers.Authorization, "Bearer server-test-key");
    const sent = JSON.parse(options.body);
    if (sent.model === "photo-test") assert.ok(sent.messages[1].content.some(({ type }) => type === "image_url"));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [
      { name: "白米饭", amount: 150, unit: "g", grams: 150, lowGrams: 120, highGrams: 180, kcal: 9999 },
    ] }) } }] });
  });

  const request = (path, payload, withAuth = true) => new Request("https://tracker.test" + path, {
    method: "POST", headers: withAuth ? { Authorization: jwt } : {}, body: JSON.stringify(payload),
  });
  assert.equal((await parse.POST(request("/api/foods/parse", { text: "米饭" }, false))).status, 401);
  assert.equal(calls.length, 0);
  const parsed = await (await parse.POST(request("/api/foods/parse", { text: "米饭" }))).json();
  assert.equal(parsed.items[0].kcal, undefined);
  const scanned = await (await photo.POST(request("/api/foods/photo", { image: "data:image/jpeg;base64,/9j/AA==" }))).json();
  assert.equal(scanned.items[0].photoRange.high, 180);
  const searched = await (await usda.GET(new Request("https://tracker.test/api/foods/search?q=rice", { headers: { Authorization: jwt } }))).json();
  assert.equal(searched.foods.length, 1);
  assert.equal(searched.foods[0].fdcId, 168878);
  assert.ok(!JSON.stringify([parsed, scanned, searched]).includes("server-test-key"));
});
