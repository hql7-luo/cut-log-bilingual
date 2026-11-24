import { CATALOG } from "./catalog.ts";
import { shiftDay, weekStart } from "./dates.ts";
import type { Change, Meal, Row, Workout } from "./model.ts";
import { fromSpec } from "./nutrition.ts";

// Example rows are visibly marked and stay separate from synced personal records.
export function sampleRows(today: string): Row[] {
  const rows: Row[] = [];
  const add = (row: Change) => rows.push({ ...row, revision: 0, cursor: 0, sample: true });
  const eat = (day: string, meal: Meal, name: string, amount: number, unit: string) => {
    const food = CATALOG.find((spec) => spec.name === name);
    if (food) add({ kind: "food", id: `example-${rows.length}`, payload: { ...fromSpec(food, amount, unit), day, meal, time: rows.length } });
  };
  eat(today, "breakfast", "燕麦片（干）", 55, "g");
  eat(today, "breakfast", "香蕉", 1, "根");
  eat(today, "breakfast", "鸡蛋", 2, "个");
  eat(today, "lunch", "白米饭", 2, "碗");
  eat(today, "lunch", "鸡胸肉（熟）", 180, "g");
  eat(today, "lunch", "熟西兰花", 150, "g");
  eat(today, "snack", "乳清蛋白粉", 1, "勺");
  eat(shiftDay(today, -1), "lunch", "牛肉拉面", 1, "碗");
  eat(shiftDay(today, -1), "breakfast", "鸡蛋", 2, "个");
  eat(shiftDay(today, -2), "dinner", "炒牛肉", 1, "份");

  const back: Workout["exercises"] = [
    { name: "高位下拉", muscle: "back", weight: 100, unit: "lb", sets: 4, reps: 10 },
    { name: "坐姿划船", muscle: "back", weight: 95, unit: "lb", sets: 3, reps: 12 },
    { name: "弯举", muscle: "arms", weight: 25, unit: "lb", sets: 3, reps: 10 },
  ];
  const monday = weekStart(today);
  const lift = (day: string, exercises: Workout["exercises"], minutes: number) =>
    add({ kind: "workout", id: `example-${rows.length}`, payload: { day, kind: "strength", exercises, minutes, note: "", time: rows.length } });
  lift(today, back, 47);
  lift(shiftDay(today, -5), back.map((move) => ({ ...move, weight: move.weight - 5 })), 43);
  if (today > monday) lift(monday, [
    { name: "倒蹬机", muscle: "legs", weight: 180, unit: "lb", sets: 4, reps: 10 },
    { name: "腿弯举", muscle: "legs", weight: 70, unit: "lb", sets: 3, reps: 12 },
  ], 42);
  if (today >= shiftDay(monday, 2)) add({ kind: "workout", id: "example-basketball", payload: {
    day: shiftDay(monday, 2), kind: "basketball", exercises: [], minutes: 65, note: "", time: 0,
  } });

  const weights = [76.6, 76.5, 76.7, 76.3, 76.2, 76.3, 76.15, 76.2, 76.05, 75.95, 75.8, 75.85, 75.7, 75.8, 75.5, 75.4, 75.3, 75.35, 75];
  for (let i = 0; i < weights.length; i++) {
    const day = shiftDay(today, (i - weights.length + 1) * 2);
    add({ kind: "weight", id: day, payload: { day, kg: weights[i] } });
  }
  return rows;
}
