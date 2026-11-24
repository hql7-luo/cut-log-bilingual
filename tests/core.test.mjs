import assert from "node:assert/strict";
import test from "node:test";
import { isDay, shiftDay, todayLA, weekStart } from "../src/lib/dates.ts";
import { DEFAULT_PROFILE, activityFor, dailyTarget, energyEstimate, recordsOf } from "../src/lib/model.ts";
import { CATALOG } from "../src/lib/catalog.ts";
import { foodTotals, nutrition, round } from "../src/lib/nutrition.ts";
import { inferDay, parseLocal } from "../src/lib/parse-food.ts";
import { trend, trendReview, weeklyWorkouts } from "../src/lib/trends.ts";
import { applyChanges, emptySnapshot, mergeRemote, visibleRows } from "../src/lib/persistence.ts";
import { recordsCsv } from "../src/lib/export.ts";
import { normalizeAgentBatch, normalizeAgentFood, agentRevision } from "../src/lib/agent-contract.ts";
import { usdaResult } from "../src/server/usda.ts";
import { parseProviderItems } from "../src/server/ai-output.ts";
import { calendarPeriod, calendarStats, shiftMonth } from "../src/lib/calendar.ts";

test("LA midnight, DST and Monday-based weeks use calendar dates", () => {
  assert.equal(todayLA(new Date("2026-11-23T07:59:00Z")), "2026-11-22");
  assert.equal(todayLA(new Date("2026-11-23T08:00:00Z")), "2026-11-23");
  assert.equal(shiftDay("2026-11-01", 1), "2026-11-02");
  assert.equal(weekStart("2026-11-22"), "2026-11-16");
  assert.equal(isDay("2026-02-30"), false);
});

test("budgets stay fixed by activity and BMR waits for user-entered age", () => {
  assert.equal(energyEstimate(DEFAULT_PROFILE), null);
  assert.equal(energyEstimate({ ...DEFAULT_PROFILE, age: 25 }).bmr, 1724);
  assert.deepEqual(dailyTarget(DEFAULT_PROFILE, "strength"), nutrition(2050, 140, 237.5, 60));
  assert.equal(activityFor([{ kind: "strength" }, { kind: "basketball" }, { kind: "basketball" }]), "both");
  assert.equal(activityFor([{ kind: "incline" }]), "rest");
});

test("calendar totals use recorded dates, their activity targets and earlier weigh-ins", () => {
  assert.deepEqual(calendarPeriod("2024-02-29", "quarter"), {
    start: "2024-01-01", end: "2024-03-31", label: "2024 年第 1 季度",
  });
  assert.equal(shiftMonth("2026-01-31", 1), "2026-02-01");
  const first = "2026-01-06";
  const second = "2026-01-07";
  const before = "2026-01-05";
  const profile = { ...DEFAULT_PROFILE, age: 25 };
  const entry = (id, day, qty) => ({
    id, kind: "food", payload: { ...parseLocal(`${qty}g 米饭`)[0], day, meal: "lunch", time: 1 },
  });
  const rows = [
    entry("food-a", first, 200), entry("food-b", second, 2000), entry("future", "2026-01-09", 100),
    { id: "w1", kind: "weight", payload: { day: "2026-01-01", kg: 78 } },
    { id: "w2", kind: "weight", payload: { day: second, kg: 76 } },
    { id: "workout", kind: "workout", payload: { day: first, kind: "strength", muscles: ["chest"], exercises: [] } },
    { id: first, kind: "activity", payload: { day: first, activity: "basketball" } },
  ];
  const stats = calendarStats(rows, profile, before, "2026-01-11", second);
  assert.equal(stats.recorded, 2);
  assert.equal(stats.elapsed, 3);
  assert.equal(stats.overTarget, 1);
  assert.equal(stats.target, profile.calories.basketball + profile.calories.rest);
  assert.equal(stats.consumed, 2860);
  assert.equal(stats.expenditure, energyEstimate({ ...profile, weight: 78, level: "low" }).tdee +
    energyEstimate({ ...profile, weight: 76, level: "low" }).tdee);
  assert.equal(stats.missingDuration, 1);
  assert.equal(stats.shortfall, stats.expenditure - 2860);
  assert.equal(stats.days[0].kcal, null);
  assert.equal(calendarStats(rows, DEFAULT_PROFILE, before, second, second).shortfall, null);
  assert.equal(weeklyWorkouts([rows[5].payload], second).muscles.chest.size, 1);
});

test("calendar distinguishes a long basketball and lifting day from lifting with short cardio", () => {
  const longDay = "2026-11-22";
  const shortDay = "2026-11-23";
  const future = "2026-11-24";
  const profile = { ...DEFAULT_PROFILE, age: 25, height: 173, weight: 80, level: "high" };
  const workout = (kind, day, minutes) => ({ kind: "workout", id: `${day}-${kind}`, payload: { day, kind, minutes, exercises: [] } });
  const rows = [workout("strength", longDay, 60), workout("basketball", longDay, 150),
    workout("strength", shortDay, 60), workout("incline", shortDay, 15), workout("other", shortDay, null),
    workout("basketball", future, 150),
    { kind: "food", id: "lunch", payload: { ...parseLocal("200g 米饭")[0], day: longDay, meal: "lunch", time: 1 } },
  ];
  const stats = calendarStats(rows, profile, longDay, future, shortDay);
  const [long, short, next] = stats.days;
  assert.equal(long.energy.baseline, 2114);
  assert.equal(short.energy.baseline, 2114);
  assert.equal(long.energy.training, 1260);
  assert.equal(short.energy.training, 300);
  assert.equal(long.expenditure, 3374);
  assert.equal(short.expenditure, 2414);
  assert.equal(long.shortfall, 3114);
  assert.equal(short.shortfall, null);
  assert.equal(short.energy.missingDuration, 1);
  assert.equal(next.expenditure, null);
  assert.equal(stats.expenditure, long.expenditure);
  assert.equal(stats.missingDuration, 0);
  assert.equal(calendarStats(rows, { ...profile, age: null }, longDay, longDay, shortDay).days[0].energy.training, 1260);
});

test("today's activity selection updates expenditure and deficit using matching durations first", () => {
  const day = "2026-11-23";
  const tomorrow = "2026-11-24";
  const profile = { ...DEFAULT_PROFILE, age: 25, height: 173, weight: 80 };
  const workout = (id, kind, minutes) => ({ kind: "workout", id, payload: { day, kind, minutes, exercises: [] } });
  const food = { kind: "food", id: "lunch", payload: { ...parseLocal("200g 米饭")[0], day, meal: "lunch", time: 1 } };
  const workoutRows = [workout("strength-a", "strength", 35), workout("strength-b", "strength", 25),
    workout("bike", "other", 25), workout("unmeasured-cardio", "incline", null), workout("unmeasured-ball", "basketball", null)];
  const choice = (activity, logs = workoutRows, today = day) => calendarStats([
    ...logs, food, { kind: "activity", id: day, payload: { day, activity } },
  ], profile, day, day, today).days[0];

  const rest = choice("rest");
  const strength = choice("strength");
  const basketball = choice("basketball");
  const both = choice("both");
  assert.deepEqual([rest, strength, basketball, both].map(({ expenditure }) => expenditure), [2219, 2429, 2639, 2849]);
  assert.deepEqual([rest, strength, basketball, both].map(({ shortfall }) => shortfall), [1959, 2169, 2379, 2589]);
  assert.deepEqual(strength.energy.assumed, []);
  assert.deepEqual(both.energy.assumed, [{ kind: "basketball", minutes: 60 }]);
  assert.equal(both.energy.missingDuration, 1);
  assert.deepEqual(choice("strength", []).energy.assumed, [{ kind: "strength", minutes: 50 }]);

  const recorded = [...workoutRows.filter(({ id }) => id !== "unmeasured-ball"), workout("timed-ball", "basketball", 150)];
  assert.equal(choice("both", recorded).energy.training, 1365);
  assert.deepEqual(choice("both", recorded).energy.assumed, []);
  const past = choice("basketball", recorded, tomorrow);
  assert.equal(past.energy.training, 1365);
  assert.equal(past.energy.fromSelection, false);
  assert.equal(past.target, profile.calories.basketball);
  const automatic = calendarStats(recorded, profile, day, day, day).days[0];
  assert.equal(automatic.energy.training, 1365);
  assert.equal(automatic.energy.fromSelection, false);
});

test("local Chinese examples resolve known references and keep restaurant ranges", () => {
  const results = parseLocal("今天中午吃了两碗米饭、三个鸡蛋和一份炒牛肉");
  assert.deepEqual(results.map((food) => food.name), ["白米饭", "鸡蛋", "炒牛肉"]);
  assert.equal(results[0].grams, 300);
  assert.equal(foodTotals(results[0]).total.kcal, 390);
  assert.equal(results[1].grams, 150);
  assert.ok(foodTotals(results[2]).bounds.high.kcal > foodTotals(results[2]).total.kcal);
  const noodles = parseLocal("晚上吃了200g鸡胸肉和一碗面");
  assert.equal(foodTotals(noodles[0]).total.protein, 62.04);
  assert.equal(noodles[1].grams, 180);
  const scoop = parseLocal("刚刚喝了两勺蛋白粉")[0];
  assert.equal(scoop.amount, 2);
  assert.equal(scoop.spec.source, "estimate");
  assert.equal(parseLocal("今天在外面吃了一份牛肉拉面")[0].name, "牛肉拉面");
});

test("English, fractions, known raw weights, unknown foods and user labels", () => {
  const parsed = parseLocal("I ate 2 eggs and 200 g raw chicken breast");
  assert.equal(parsed[0].spec.fdcId, 173424);
  assert.equal(parsed[1].spec.fdcId, 171077);
  assert.equal(parseLocal("半碗米饭")[0].grams, 75);
  assert.equal(parseLocal("一碗半米饭")[0].grams, 225);
  assert.equal(parseLocal("banana 1/2 serving")[0].grams, 59);
  const apple = parseLocal("100g苹果")[0];
  assert.equal(apple.spec.fdcId, 171688);
  assert.equal(foodTotals(apple).total.kcal, 52);
  assert.equal(parseLocal("一个苹果")[0].grams, 182);
  const unknown = parseLocal("一份花雕鱼")[0];
  assert.equal(unknown.name, "花雕鱼");
  assert.equal(foodTotals(unknown), null);
  assert.equal(inferDay("昨天吃了饭", "2026-11-23", "2026-11-23"), "2026-11-22");
  const preferred = { ...CATALOG.find(({ name }) => name === "乳清蛋白粉"), source: "label", base: nutrition(120, 25, 2, 1) };
  const whey = parseLocal("两勺蛋白粉", [preferred, ...CATALOG])[0];
  assert.equal(foodTotals(whey).total.protein, 50);
  assert.equal(whey.spec.source, "label");
});

test("USDA mapping rejects incomplete results, and the model can only supply parsing fields", () => {
  const food = { fdcId: 99999, description: "Fixture chicken", dataType: "Foundation", foodNutrients: [
    { nutrientId: 2048, unitName: "KCAL", value: 160 }, { nutrientId: 1003, unitName: "G", value: 30 },
    { nutrientId: 1004, unitName: "G", value: 4 }, { nutrientId: 1005, unitName: "G", value: 0 },
  ] };
  assert.equal(usdaResult(food).base.carbs, 0);
  assert.equal(usdaResult({ ...food, foodNutrients: food.foodNutrients.slice(0, 2) }), null);
  assert.equal(usdaResult({ ...food, dataType: "Branded" }), null);
  const [item] = parseProviderItems(JSON.stringify({ items: [
    { name: "米饭", amount: 150, unit: "g", grams: 150, lowGrams: 100, highGrams: 210, kcal: 9000, fdcId: 9 },
  ] }));
  assert.equal(item.kcal, undefined);
  assert.equal(item.fdcId, undefined);
  assert.deepEqual(item.photoRange, { low: 100, high: 210 });
  const draft = { ...parseLocal("150g米饭")[0], photoRange: item.photoRange };
  assert.deepEqual([foodTotals(draft).bounds.low.kcal, foodTotals(draft).bounds.high.kcal], [130, 273]);
});

test("training counts distinct days and 14-day reviews require two comparable weekly changes", () => {
  const today = "2026-11-22";
  const workouts = [{ day: "2026-11-16", kind: "strength", exercises: [{ muscle: "legs" }] },
    { day: "2026-11-16", kind: "strength", exercises: [{ muscle: "legs" }] },
    { day: "2026-11-17", kind: "basketball", exercises: [] }];
  const week = weeklyWorkouts(workouts, today);
  assert.equal(week.muscles.legs.size, 1);
  assert.equal(week.strength, 1);
  assert.equal(week.basketball, 1);
  const days = (length, start, slope) => Array.from({ length }, (_, i) => ({ day: shiftDay(start, i), kg: 80 - i * slope }));
  assert.equal(trend([{ day: today, kg: 78 }], today, DEFAULT_PROFILE).rate, null);
  assert.equal(trendReview(days(14, "2026-10-26", 0.01), "2026-11-08", DEFAULT_PROFILE).adjustment, 0);
  assert.equal(trendReview(days(28, "2026-10-26", 0.01), today, DEFAULT_PROFILE).adjustment, -125);
  assert.equal(trendReview(days(28, "2026-10-26", 0.13), today, DEFAULT_PROFILE).adjustment, 125);
  assert.equal(trendReview(days(28, "2026-10-26", 0.01), today, { ...DEFAULT_PROFILE, handledReview: today }).adjustment, 0);
  assert.equal(round(trend(days(28, "2026-10-26", 0.07), today, DEFAULT_PROFILE).rate, 2), 0.49);
  assert.equal(DEFAULT_PROFILE.calories.rest, 1900);
});

test("browser writes, reversals, CSV guarding, and independent remote records", () => {
  const day = "2026-11-22";
  const food = { ...parseLocal("100g 米饭")[0], name: "=SUM(1,1)", day, meal: "lunch", time: 4 };
  const source = { kind: "food", id: "d1", payload: food };
  const local = applyChanges(emptySnapshot(), [source], false);
  assert.equal(recordsOf(visibleRows(local), "food").length, 1);
  const csv = recordsCsv(visibleRows(local));
  assert.ok(csv.includes('"\'=SUM(1,1)"'));
  assert.equal(recordsOf(visibleRows(applyChanges(local, [{ ...source, payload: null }], false)), "food").length, 0);
  const restored = applyChanges(emptySnapshot(), [{ ...source, sample: true }], false);
  assert.equal(visibleRows(restored)[0].sample, true);
  assert.ok(!recordsCsv(visibleRows(restored)).includes("SUM(1,1)"));
  const cloud = applyChanges(emptySnapshot(), [source, { ...source, payload: null }], true);
  assert.deepEqual(cloud.pending.map(({ expected }) => expected), [0, 1]);
  const merged = mergeRemote(cloud, [{ ...source, id: "agent-2", revision: 1, cursor: 6 }], true);
  assert.equal(merged.cursor, 6);
  assert.deepEqual(recordsOf(visibleRows(merged), "food").map(({ id }) => id), ["agent-2"]);
});

test("external contract requires complete values, valid history dates and an edit revision", () => {
  const rice = { name: "米饭", amount: 150, unit: "g", kcal: 195, protein_g: 4, carbs_g: 42, fat_g: 0.4 };
  const batch = normalizeAgentBatch({ date: "2026-11-20", meal: "lunch", items: [rice, rice], input_type: "photo", preview: true }, "2026-11-22");
  assert.equal(batch.items.length, 2);
  assert.equal(batch.items[0].grams, 150);
  assert.equal(batch.items[0].source, "estimate");
  assert.equal(batch.confirmed, false);
  assert.throws(() => normalizeAgentFood({ ...rice, protein_g: null }));
  assert.throws(() => normalizeAgentFood({ ...rice, grams: 130 }));
  assert.throws(() => normalizeAgentBatch({ ...batch, date: "2026-11-23" }, "2026-11-22"));
  assert.throws(() => normalizeAgentBatch({ ...batch, items: [{ ...rice, source: "label" }] }, "2026-11-22"));
  assert.throws(() => agentRevision(null), { status: 428 });
  assert.equal(agentRevision('"2"'), 2);
});
