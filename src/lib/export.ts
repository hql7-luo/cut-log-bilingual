import { ACTIVITY_LABELS, MEAL_LABELS, MUSCLE_LABELS, recordsOf, WORKOUT_LABELS, type Row } from "./model.ts";
import { foodTotals, round, sourceLabel } from "./nutrition.ts";
import { translate, type Language } from "./locale.ts";

function cell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  // Spreadsheet programs can execute cells interpreted as formulas.
  const safe = typeof value === "string" && /^[\s]*[=+\-@]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function recordsCsv(rows: Row[], language: Language = "zh") {
  const clean = rows.filter((row) => !row.sample);
  const t = (text?: string) => text === undefined ? undefined : translate(language, text);
  const data: (string | number | undefined | null)[][] = [
    ["记录类型", "日期", "餐次或活动", "名称", "数量", "单位", "总克重", "热量 kcal", "蛋白质 g", "碳水 g", "脂肪 g",
      "来源", "时长 min", "肌群", "重量", "重量单位", "组数", "每组次数", "体重 kg", "备注", "结构化数据"].map(t),
  ];
  for (const { payload } of recordsOf(clean, "food")) {
    const values = foodTotals(payload)?.total;
    data.push([t("饮食"), payload.day, t(MEAL_LABELS[payload.meal]), t(payload.name), payload.amount, t(payload.unit), payload.grams,
      values && round(values.kcal, 2), values && round(values.protein, 2), values && round(values.carbs, 2), values && round(values.fat, 2),
      t(sourceLabel(payload)), null, null, null, null, null, null, null, t(payload.note || payload.spec?.note), JSON.stringify(payload)]);
  }
  for (const { payload } of recordsOf(clean, "workout")) {
    const moves = payload.exercises.length ? payload.exercises : [null];
    // Duration belongs to the session, even when the export has one row per exercise.
    for (const [index, move] of moves.entries()) data.push([t("训练"), payload.day, t(WORKOUT_LABELS[payload.kind]), t(move?.name), null, null, null, null, null, null,
      null, null, index === 0 ? payload.minutes : null, move ? t(MUSCLE_LABELS[move.muscle]) : null, move?.weight, move?.unit, move?.sets, move?.reps,
      null, payload.note, JSON.stringify(payload)]);
  }
  for (const { payload } of recordsOf(clean, "weight")) data.push([t("体重"), payload.day, ...Array(16).fill(null), payload.kg]);
  for (const { payload } of recordsOf(clean, "activity")) data.push([t("活动类型"), payload.day, t(ACTIVITY_LABELS[payload.activity])]);
  for (const row of clean) {
    if (row.payload && (row.kind === "profile" || row.kind.endsWith("_preset"))) {
      data.push([row.kind, null, null, row.id, ...Array(16).fill(null), JSON.stringify(row.payload)]);
    }
  }
  const columns = data[0].length;
  return "\ufeff" + data.map((line) => Array.from({ length: columns }, (_, index) => cell(line[index])).join(",")).join("\r\n");
}

export function downloadCsv(rows: Row[], today: string, language: Language = "zh") {
  const url = URL.createObjectURL(new Blob([recordsCsv(rows, language)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cut-log-${today}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
