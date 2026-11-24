"use client";

import { useLanguage } from "./language";
import { useRef, useState } from "react";
import type { FoodDraft, FoodSpec, Nutrition } from "../lib/model";
import { fdcLink, foodTotals, fromSpec, NUTRIENT_LABEL, NUTRIENTS, number, nutrition, portionGrams, sourceLabel, weightInGrams, whole } from "../lib/nutrition";
import { Button, ErrorText, Field, Icon } from "./ui";

export const blankFood = (name = ""): FoodDraft => ({ name, amount: 1, unit: "份", grams: null, estimatedPortion: false, note: "", lookup: "", spec: null });

export function FoodEditor({ food, label, save, close, editRecord = false }: {
  food: FoodDraft; label: boolean; save: (food: FoodDraft, favorite: boolean) => Promise<void> | void; close: () => void;
  editRecord?: boolean;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(food);
  const [manual, setManual] = useState(!food.spec || label);
  const [basis, setBasis] = useState<"serving" | "100">("serving");
  const [labelGrams, setLabelGrams] = useState("");
  const [aliases, setAliases] = useState("");
  const [favorite, setFavorite] = useState(label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Keep an explicitly measured portion when the number of servings changes.
  const measured = useRef(!food.estimatedPortion && food.grams !== null && food.amount > 0
    ? { unit: food.unit, gramsPerUnit: food.grams / food.amount } : null);
  const initial = foodTotals(food)?.total;
  const [values, setValues] = useState(() => Object.fromEntries(NUTRIENTS.map((key) =>
    [key, initial ? String(Math.round(initial[key] * 10) / 10) : ""])) as Record<keyof Nutrition, string>);
  const entry = foodTotals(draft);
  const units = [...new Set([draft.unit, "g", "份", "个", "碗", "勺", "杯", "片", "块", "瓶", ...Object.keys(draft.spec?.portions ?? {})])];

  function portion(amount: number, unit: string) {
    const weighed = weightInGrams(amount, unit);
    const actual = measured.current?.unit === unit ? measured.current.gramsPerUnit * amount : null;
    const guessed = draft.spec ? portionGrams(draft.spec, amount, unit) : null;
    setDraft({ ...draft, unit, amount, grams: amount > 0 ? weighed ?? actual ?? guessed : null, photoRange: undefined,
      estimatedPortion: weighed === null && actual === null && !!guessed && draft.spec?.source !== "label" });
  }

  function setGrams(value: string) {
    const grams = value ? Number(value) : null;
    const amount = draft.unit === "g" && grams !== null ? grams : draft.amount;
    measured.current = grams && amount > 0 ? { unit: draft.unit, gramsPerUnit: grams / amount } : null;
    setDraft({ ...draft, amount, grams, estimatedPortion: false, photoRange: undefined });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!draft.name.trim() || draft.amount <= 0 || draft.amount > 10_000) { setError("请填写食物名称和有效份量。"); return; }
    let ready: FoodDraft = { ...draft, name: draft.name.trim() };
    if (manual) {
      if (NUTRIENTS.some((key) => values[key].trim() === "" || !Number.isFinite(Number(values[key])) || Number(values[key]) < 0)) {
        setError("请填写四项营养。包装上标为 0 时可以填 0。");
        return;
      }
      const base = nutrition(Number(values.kcal), Number(values.protein), Number(values.carbs), Number(values.fat));
      if (label) {
        const serving = basis === "serving";
        const mass = serving ? Number(labelGrams) || null : 100;
        const labelUnit = serving ? (draft.unit === "g" ? "份" : draft.unit) : "g";
        const spec: FoodSpec = {
          name: ready.name, aliases: aliases.split(/[,，、]/).map((word) => word.trim()).filter(Boolean).slice(0, 15),
          category: "其他", source: "label", base, basisGrams: mass, defaultUnit: labelUnit, defaultAmount: serving ? 1 : 100,
          portions: serving && mass ? { [labelUnit]: mass, 份: mass } : {},
          note: serving ? "营养按包装每份录入。" : "营养按包装每 100 g 录入。",
        };
        ready = fromSpec(spec, serving ? draft.amount : draft.grams ?? 100, labelUnit);
      } else {
        const mass = ready.grams ?? weightInGrams(ready.amount, ready.unit);
        ready = { ...ready, spec: {
          name: ready.name, aliases: [], category: ready.spec?.category ?? "其他", source: "manual", base,
          basisGrams: mass, defaultUnit: ready.unit, defaultAmount: ready.amount, portions: mass ? { [ready.unit]: mass / ready.amount } : {},
          note: "此份营养由你手动确认。",
        }, note: "", estimatedPortion: false, photoRange: undefined };
      }
    }
    if (!foodTotals(ready)) { setError("这个单位尚未换算。可填实际克重，或填写本次营养。"); return; }
    setBusy(true);
    try { await save(ready, favorite); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <form className="food-editor form-stack" onSubmit={submit}>
    {!editRecord && <div className="inline-heading">
      <h3>{label ? t("按包装营养标签创建") : t("核对份量与营养")}</h3>
      <Button variant="quiet" onClick={close}>{t("返回")}</Button>
    </div>}
    <Field label={t("食品名称")}><input required maxLength={140} value={t(draft.name)} placeholder={t("比如某品牌乳清蛋白粉")}
      onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></Field>
    {label && <Field label={t("别名（选填，用逗号分开）")}>
      <input value={aliases} maxLength={180} placeholder={t("蛋白粉，whey")} onChange={(e) => setAliases(e.target.value)}/>
    </Field>}
    {label && <Field label={t("包装营养基准")}><select value={basis} onChange={(e) => {
      const mode = e.target.value as "serving" | "100";
      const mass = draft.grams || 100;
      setBasis(mode);
      setDraft({ ...draft, amount: mode === "100" ? mass : 1, unit: mode === "100" ? "g" : "份", grams: mode === "100" ? mass : null });
    }}><option value="serving">{t("每标签份")}</option><option value="100">{t("每 100 g")}</option></select></Field>}
    <div className="form-grid">
      <Field label={t("份量")}><input type="number" inputMode="decimal" min="0.01" max="10000" step="any" required
        value={draft.amount || ""} onChange={(e) => portion(Number(e.target.value), draft.unit)}/></Field>
      <Field label={t("单位")}><select value={draft.unit} disabled={label && basis === "100"}
        onChange={(e) => portion(draft.amount, e.target.value)}>{units.map((unit) => <option key={unit} value={unit}>{t(unit)}</option>)}</select></Field>
      {label && basis === "serving" ? <Field label={t("标签每份克重（选填）")}><input type="number" inputMode="decimal" min="0.01"
        max="10000" step="any" value={labelGrams} placeholder={t("例如 32")} onChange={(e) => setLabelGrams(e.target.value)}/></Field> :
        !label && <Field label={t("本次总克重（选填）")}><input type="number" inputMode="decimal" min="0.01" max="20000" step="any"
          value={draft.grams === null ? "" : Number(draft.grams.toFixed(2))} onChange={(e) => setGrams(e.target.value)}/></Field>}
    </div>
    {draft.spec && !label && <div className="source-box">
      <span className="badge">{t(sourceLabel(draft))}{draft.estimatedPortion && draft.spec.source !== "estimate" ? ` ${t("· 份量估算")}` : ""}</span>
      {draft.spec.fdcId && <a className="text-link" href={fdcLink(draft.spec.fdcId)} target="_blank" rel="noreferrer">FDC {draft.spec.fdcId}</a>}
      {draft.spec.note && <p>{t(draft.spec.note)}</p>}
      {draft.note && <p>{t(draft.note)}</p>}
      {entry ? <p>{whole.format(entry.total.kcal)} {t("kcal · 蛋白质")} {number.format(entry.total.protein)} {t("g · 碳水")} {number.format(entry.total.carbs)} {t("g · 脂肪")} {number.format(entry.total.fat)} g</p> :
        <p>{t("请填写克重或选择可换算的单位。")}</p>}
      {entry?.bounds && <p>{t("估算范围")} {whole.format(entry.bounds.low.kcal)}–{whole.format(entry.bounds.high.kcal)} kcal
        {(["protein", "carbs", "fat"] as const).map((key) =>
          ` · ${t(NUTRIENT_LABEL[key])} ${number.format(entry.bounds!.low[key])}–${number.format(entry.bounds!.high[key])} g`)}</p>}
      <label className="checkbox"><input type="checkbox" checked={manual} onChange={(event) => {
        if (event.target.checked && entry) setValues(Object.fromEntries(NUTRIENTS.map((key) =>
          [key, String(Math.round(entry.total[key] * 10) / 10)])) as Record<keyof Nutrition, string>);
        setManual(event.target.checked);
      }}/> {t("修改本次营养")}</label>
    </div>}
    {manual && <div className="form-grid four">
      {NUTRIENTS.map((key) => <Field label={`${t(NUTRIENT_LABEL[key])} (${key === "kcal" ? "kcal" : "g"})`} key={key}>
        <input type="number" inputMode="decimal" min="0" max={key === "kcal" ? "20000" : "3000"} step="any"
          required value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })}/>
      </Field>)}
    </div>}
    <label className="checkbox"><input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)}/> {t("保存为常吃食物")}</label>
    <ErrorText>{error}</ErrorText>
    <Button type="submit" icon="check" variant="primary" disabled={busy}>
      {busy ? t("正在保存…") : editRecord ? t("保存修改") : t("确认这项食物")}
    </Button>
  </form>;
}
