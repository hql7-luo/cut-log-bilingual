import assert from "node:assert/strict";
import test from "node:test";
import { calendarPeriod } from "../src/lib/calendar.ts";
import { dateTitle } from "../src/lib/dates.ts";
import { recordsCsv } from "../src/lib/export.ts";
import { asLanguage, translate } from "../src/lib/locale.ts";
import { foodTotals, portionText } from "../src/lib/nutrition.ts";
import { parseLocal } from "../src/lib/parse-food.ts";

test("the same food record displays in both languages without changing its stored data", () => {
  const [egg, rice] = parseLocal("For lunch I had two eggs and 200 g of rice.");
  assert.equal(egg.name, "鸡蛋");
  assert.equal(translate("en", egg.name), "Eggs");
  assert.match(portionText(egg), /^2个/);
  assert.match(portionText(egg, "en"), /^2 pieces/);
  assert.equal(foodTotals(rice).total.kcal, 260);
  const rows = [{ kind: "food", id: "rice", payload: { ...rice, day: "2026-11-23", meal: "lunch" } }];
  assert.match(recordsCsv(rows, "en"), /"Record type","Date","Meal or activity"/);
  assert.match(recordsCsv(rows, "en"), /"Food","2026-11-23","Lunch","Cooked white rice"/);
  assert.match(recordsCsv(rows, "zh"), /"饮食","2026-11-23","午餐","白米饭"/);
  assert.equal(rice.name, "白米饭");
});

test("language selection and localized dates preserve calendar boundaries", () => {
  const t = (message, ...values) => translate("en", message, ...values);
  assert.equal(asLanguage("en"), "en");
  assert.equal(asLanguage("unsupported"), null);
  assert.equal(t`删除 ${"Eggs"}`, "Delete Eggs");
  assert.equal(t("toString"), "toString");
  assert.equal(dateTitle("2026-11-23", "en"), "Mon, Nov 23");
  assert.equal(dateTitle("2026-11-23", "zh"), "11月23日星期一");
  assert.deepEqual(calendarPeriod("2026-11-23", "month", "en"), {
    start: "2026-11-01", end: "2026-11-30", label: "November 2026",
  });
});
