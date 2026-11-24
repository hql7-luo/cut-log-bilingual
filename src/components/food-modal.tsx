"use client";

import { useLanguage } from "./language";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATALOG, searchCatalog } from "../lib/catalog";
import { dateTitle, isDay } from "../lib/dates";
import { type FoodDraft, type FoodPreset, type FoodSpec, type LogRow, type Meal, MEALS, MEAL_LABELS, makeId } from "../lib/model";
import { fdcLink, foodTotals, fromSpec, number, portionText, sourceLabel, sum, whole } from "../lib/nutrition";
import { applyFoodChoice, inferDay, inferMeal, parseLocal, resolveFood, type ParsedFood } from "../lib/parse-food";
import { Button, ErrorText, Field, Icon, IconButton, Modal } from "./ui";
import { blankFood, FoodEditor } from "./food-editor";

export type Providers = { ai: boolean; usda: boolean; vision: boolean };
type DraftItem = { key: string; food: FoodDraft; origin: "input" | "manual" };
type Tab = "text" | "photo" | "search" | "quick";
type Editor = { item: DraftItem; label: boolean };
const tabs = { text: "文字/听写", photo: "拍照", search: "搜索食物", quick: "常吃" };

type Speech = {
  lang: string; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null; start: () => void; abort: () => void;
};

async function photoData(file: File) {
  if (file.size > 20_000_000) throw new Error("请选择 20 MB 以内的照片。");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const size = Math.min(1, 1024 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * size);
    canvas.height = Math.round(image.height * size);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取照片。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch { throw new Error("照片无法读取。可以尝试相机拍摄或选用 JPEG。"); }
  finally { URL.revokeObjectURL(objectUrl); }
}

// This dialog keeps every text or photo result as a draft until the user saves.
export function FoodModal({ today, date, keepDay = false, initialMeal, initial, entryId, favorites, history, providers, getToken, save, setFavorite, close }: {
  today: string; date: string; keepDay?: boolean; initialMeal?: Meal; initial?: FoodDraft[]; entryId?: string;
  favorites: LogRow<"food_preset">[]; history: LogRow<"food">[]; providers: Providers;
  getToken: () => Promise<string>;
  save: (foods: FoodDraft[], day: string, meal: Meal) => Promise<void>;
  setFavorite: (entry: FoodDraft) => Promise<void>;
  close: () => void;
}) {
  const { language, t } = useLanguage();
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState("");
  const [photoNote, setPhotoNote] = useState("");
  const [day, setDay] = useState(date);
  const [meal, setMeal] = useState<Meal>(initialMeal ?? inferMeal(""));
  const [pickedDay, setPickedDay] = useState(keepDay);
  const [pickedMeal, setPickedMeal] = useState(Boolean(initialMeal));
  const [textSuggestion, setTextSuggestion] = useState<{ day?: string; meal?: Meal }>({});
  const [items, setItems] = useState<DraftItem[]>(() => (initial ?? []).map((food) => ({ key: makeId(), food, origin: "manual" })));
  const [editor, setEditor] = useState<Editor | null>(() => entryId && items[0] ? { item: items[0], label: false } : null);
  const [replace, setReplace] = useState("");
  const [search, setSearch] = useState("");
  const [online, setOnline] = useState<FoodSpec[]>([]);
  const [preferAi, setPreferAi] = useState(providers.ai);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [micSupported, setMicSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const speech = useRef<Speech | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const getSpeech = () => {
    const browser = window as typeof window & { webkitSpeechRecognition?: new () => Speech; SpeechRecognition?: new () => Speech };
    return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  };
  useEffect(() => {
    setMicSupported(Boolean(getSpeech()));
    return () => speech.current?.abort();
  }, []);

  const savedFoods = useMemo(() => favorites.map(({ payload }) => payload), [favorites]);
  const known = useMemo(() => [...savedFoods.map(({ spec }) => spec), ...CATALOG], [savedFoods]);
  const localResults = searchCatalog(search, known);
  const common = useMemo(() => {
    const counts = new Map<string, { food: FoodDraft; count: number }>();
    for (const { payload } of history) {
      if (!payload.spec) continue;
      const key = payload.name.toLocaleLowerCase();
      const previous = counts.get(key);
      counts.set(key, { food: previous?.food ?? payload, count: (previous?.count ?? 0) + 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  }, [history]);
  const unresolved = items.some(({ food }) => !foodTotals(food));
  const total = sum(items.flatMap(({ food }) => foodTotals(food)?.total ?? []));

  async function callProvider(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${await getToken()}`,
        ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(27_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "在线服务暂不可用。");
    return result;
  }

  function preview(foods: FoodDraft[]) {
    if (!foods.length) { setError("未找到食物。请试试更简短的描述或手动添加。"); return; }
    setItems((old) => [...old.filter(({ origin }) => origin !== "input"),
      ...foods.map((food): DraftItem => ({ key: makeId(), food, origin: "input" }))]);
    setTimeout(() => feedback.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 80);
  }

  async function parse() {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError("");
    setMessage("");
    // Keep the date and meal the user picked. Show any conflicting text beside the preview.
    const inferredDay = inferDay(text, today, day);
    const inferredMeal = inferMeal(text, new Date(), meal);
    setTextSuggestion({
      day: pickedDay && inferredDay !== day ? inferredDay : undefined,
      meal: pickedMeal && inferredMeal !== meal ? inferredMeal : undefined,
    });
    if (!pickedDay) setDay(inferredDay);
    if (!pickedMeal) setMeal(inferredMeal);
    const local = parseLocal(text, known, savedFoods);
    try {
      if (preferAi && providers.ai && !local.some((food) => food.reportedNutrition)) {
        const result = await callProvider("/api/foods/parse", { text, language });
        preview((result.items as ParsedFood[]).map((item) => resolveFood(item, known, savedFoods)));
      } else preview(local);
    } catch { setMessage("在线解析暂不可用，已使用本地解析。"); preview(local); }
    finally { setLoading(false); }
  }

  async function analyzePhoto() {
    if (!photo || !providers.vision || loading) return;
    setLoading(true);
    setError("");
    setMessage("");
    setTextSuggestion({});
    try {
      const result = await callProvider("/api/foods/photo", { image: photo, note: photoNote.trim(), language });
      preview((result.items as ParsedFood[]).map((item) => {
        const food = resolveFood(item, known);
        return { ...food, estimatedPortion: true, photoRange: item.photoRange };
      }));
      setMessage("请核对照片识别出的食物和份量，再保存。");
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }

  function dictate() {
    if (listening) { speech.current?.abort(); return; }
    const SpeechRecognition = getSpeech();
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = language === "en" ? "en-US" : "zh-CN";
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) setText((before) => `${before ? before + "，" : ""}${transcript}`.slice(0, 700));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setMessage("可改用系统键盘上的听写按钮。");
    };
    try { recognition.start(); speech.current = recognition; setListening(true); }
    catch { setMessage("可改用系统键盘上的听写按钮。"); }
  }

  async function searchUsda() {
    if (!providers.usda || search.trim().length < 2 || loading) return;
    setLoading(true);
    setError("");
    setOnline([]);
    try {
      const result = await callProvider("/api/foods/search?" + new URLSearchParams({ q: search.trim() }));
      setOnline(result.foods);
      if (!result.foods.length) setMessage("没有找到营养信息完整的 USDA 条目。可试英文名或录入包装标签。");
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }

  const append = (food: FoodDraft) => setItems((before) => [...before, { key: makeId(), food, origin: "manual" }]);

  function choose(spec: FoodSpec) {
    if (replace) {
      setItems((before) => before.map((item) => item.key === replace ? { ...item, food: applyFoodChoice(item.food, spec) } : item));
      setReplace("");
    } else append(fromSpec(spec));
  }

  function useFavorite(preset: FoodPreset) {
    append({ ...fromSpec(preset.spec, preset.amount, preset.unit), grams: preset.grams });
  }

  async function saveAll() {
    if (!items.length || unresolved || loading || !day || day > today) return;
    setLoading(true);
    setError("");
    try { await save(items.map(({ food: { reportedNutrition, ...food } }) => food), day, meal); }
    catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }

  function addManual(label = false, matching = "") {
    const item = items.find(({ key }) => key === matching);
    setEditor({ label, item: item ?? { key: makeId(), food: blankFood(search), origin: "manual" } });
  }

  // Keep date and meal adjustable when opening a saved item directly in its editor.
  const dateAndMeal = <div className="form-grid date-meal">
    <Field label={t("日期")}><input type="date" max={today} value={day} onChange={(e) => {
      setDay(e.target.value);
      setPickedDay(true);
      setTextSuggestion((before) => ({ ...before, day: undefined }));
    }}/></Field>
    <Field label={t("餐次")}><select value={meal} onChange={(e) => {
      setMeal(e.target.value as Meal);
      setPickedMeal(true);
      setTextSuggestion((before) => ({ ...before, meal: undefined }));
    }}>{MEALS.map((key) =>
      <option key={key} value={key}>{t(MEAL_LABELS[key])}</option>)}</select></Field>
  </div>;

  return <Modal title={entryId ? t("编辑饮食") : initial?.length ? t("确认餐食") : t("记录饮食")} close={close} wide
    footer={!editor && items.length > 0 && <>
      <div className="footer-total"><strong>{whole.format(total.kcal)} kcal</strong><span>{t("蛋白质")} {number.format(total.protein)} g</span></div>
      <Button variant="primary" icon="check" disabled={!items.length || unresolved || loading || !day || day > today} onClick={saveAll}>
        {loading ? t("处理中…") : entryId ? t("保存修改") : day === today ? t("保存到今天") : t`保存到${" " + day.slice(5)}`}
      </Button>
    </>}>
    {editor ? <>
      {entryId && dateAndMeal}
      <FoodEditor key={editor.item.key} food={editor.item.food} label={editor.label} editRecord={Boolean(entryId)}
        close={() => entryId ? close() : setEditor(null)}
      save={async (food, favorite) => {
        if (entryId && (!isDay(day) || day > today)) throw new Error("请选择今天或过去的日期。");
        if (favorite) await setFavorite(food);
        if (entryId) {
          await save([food], day, meal);
          return;
        }
        setItems((before) => before.some(({ key }) => key === editor.item.key)
          ? before.map((item) => item.key === editor.item.key ? { ...item, food } : item)
          : [...before, { ...editor.item, food }]);
        if (editor.item.key === replace) setReplace("");
        setEditor(null);
      }}/></> : <>
      {dateAndMeal}
      {!entryId && <>
        <div className="segments food-tabs" role="group" aria-label={t("饮食录入方式")}>{(Object.keys(tabs) as Tab[]).map((value) =>
          <button type="button" key={value} aria-pressed={value === tab} onClick={() => {
            setTab(value); setError(""); setMessage(""); if (value !== "search") setReplace("");
          }}>{t(tabs[value])}</button>)}</div>
        {tab === "text" && <div className="food-input form-stack">
          <label className="field"><span>{t("吃了什么？")}</span><textarea rows={3} maxLength={700} value={text}
            placeholder={t("今天中午吃了两碗米饭、三个鸡蛋和一份炒牛肉")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void parse(); }}/></label>
          <div className="inline-heading wrap">
            <div className="inline-actions wrap">
              {providers.ai && <label className="checkbox"><input type="checkbox" checked={preferAi}
                onChange={(e) => setPreferAi(e.target.checked)}/> {t("在线识别")}</label>}
              {!items.length && <Button variant="quiet" onClick={() => addManual()}>{t("手动录入")}</Button>}
            </div>
            <div className="inline-actions">
              {micSupported && <IconButton icon="microphone" label={listening ? t("停止听写") : t("开始听写")} onClick={dictate}/>}
              <Button icon="sparkle" onClick={parse} disabled={loading || !text.trim()}>{t("解析并预览")}</Button>
            </div>
          </div>
        </div>}
        {tab === "photo" && (!providers.vision ? <div className="source-box">
          <p>{t("网页拍照识别需要配置视觉模型。")}</p>
          <Button variant="quiet" onClick={() => setTab("text")}>{t("用文字记餐")}</Button>
        </div> : <div className="form-stack">
          <div className="photo-box">
            {photo ? <img src={photo} alt={t("待分析的餐食照片")}/> : <><Icon name="food" size={28}/><span>{t("拍摄或选择一张餐食照片")}</span></>}
            <div className="inline-actions">
              <Button icon="plus" onClick={() => cameraInput.current?.click()}>{t("拍照")}</Button>
              <Button variant="quiet" onClick={() => photoInput.current?.click()}>{t("选择照片")}</Button>
            </div>
          </div>
          {[cameraInput, photoInput].map((ref, index) => <input key={index} ref={ref} type="file" accept="image/*"
            capture={index === 0 ? "environment" : undefined} hidden aria-label={index === 0 ? t("拍照文件") : t("照片文件")}
            onChange={async (e) => {
              const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
              try { setPhoto(await photoData(file)); setError(""); } catch (failure) { setError((failure as Error).message); }
            }}/>)}
          <Field label={t("份量或做法（选填）")}><input value={photoNote} maxLength={350} placeholder={t("比如：只吃了一半，鸡肉是烤的")}
            onChange={(e) => setPhotoNote(e.target.value)}/></Field>
          <div className="inline-heading">
            <span className="fine">{t("照片会发给视觉模型用于识别。")}</span>
            <Button icon="sparkle" onClick={analyzePhoto} disabled={!photo || loading}>{t("分析照片")}</Button>
          </div>
        </div>)}
        {tab === "search" && <div className="form-stack">
          {replace && <p className="fine">{t("为待确认的记录选择匹配食物。")}</p>}
          <label className="field"><span>{t("中英文食品名称")}</span><div className="search-field"><Icon name="search" size={18}/>
            <input value={search} maxLength={110} placeholder={t("米饭、蛋白粉、chicken breast")} onChange={(e) => {
              setSearch(e.target.value); setOnline([]); setMessage("");
            }}/></div></label>
          <div className="inline-actions wrap">
            {providers.usda && <Button icon="search" onClick={searchUsda} disabled={loading || search.trim().length < 2}>{t("查 USDA")}</Button>}
            <Button variant="quiet" onClick={() => addManual(true, replace)} icon="plus">{t("包装标签")}</Button>
            <Button variant="quiet" onClick={() => addManual(false, replace)} icon="edit">{t("手动填写")}</Button>
          </div>
          {([...online, ...localResults.slice(0, search ? 15 : 8)]).map((spec, index) =>
            <button type="button" className="catalog-option" key={`${spec.name}-${index}`} onClick={() => choose(spec)}>
              <span><strong>{t(spec.name)}</strong><small>{t(sourceLabel(fromSpec(spec)))} · {whole.format(spec.base.kcal)} kcal / {spec.basisGrams ? `${spec.basisGrams} g` : t("标签份")}</small></span>
              <Icon name="plus" size={17}/>
            </button>)}
          {!online.length && !localResults.length && <p className="fine">{t("本地食物库中暂无匹配。")}</p>}
        </div>}
        {tab === "quick" && <div className="form-stack">
          {favorites.map(({ id, payload }) => <button type="button" className="catalog-option" key={id} onClick={() => useFavorite(payload)}>
            <span><strong>{t(payload.spec.name)}</strong><small>{number.format(payload.amount)} {t(payload.unit)} {t("· 已保存")}</small></span><Icon name="plus" size={17}/>
          </button>)}
          {common.length > 0 && <h3 className="minor-heading">{t("最近常吃")}</h3>}
          {common.map(({ food, count }) => <button type="button" className="catalog-option" key={food.name} onClick={() => append(food)}>
            <span><strong>{t(food.name)}</strong><small>{t`${portionText(food, language)} · 记录 ${count} 次`}</small></span><Icon name="plus" size={17}/>
          </button>)}
          {!favorites.length && !common.length && <p className="fine">{t("保存为常吃，或记录几顿饭后在这里快速添加。")}</p>}
          <Button onClick={() => addManual(true)} icon="plus">{t("创建包装食品")}</Button>
        </div>}
      </>}
      {message && <p className="notice" role="status">{t(message)}</p>}
      <ErrorText>{error}</ErrorText>
      {items.length > 0 && <div className="review-list" ref={feedback}>
        {(textSuggestion.day || textSuggestion.meal) && <div className="source-box">
          <p role="status">{t`文字里写的是 ${[textSuggestion.day && dateTitle(textSuggestion.day, language),
            textSuggestion.meal && t(MEAL_LABELS[textSuggestion.meal])].filter(Boolean).join(" · ")}，已保留手选值。`}</p>
          <Button variant="quiet" onClick={() => {
            if (textSuggestion.day) setDay(textSuggestion.day);
            if (textSuggestion.meal) setMeal(textSuggestion.meal);
            setTextSuggestion({});
          }}>{t("改用文字里的日期或餐次")}</Button>
        </div>}
        <div className="inline-heading"><h3>{t("确认食物")} <span>{items.length}</span></h3>
          {!entryId && <Button variant="quiet" icon="plus" onClick={() => addManual()}>{t("手动添加")}</Button>}
        </div>
        {items.map((item) => {
          const { food } = item;
          const name = t(food.name);
          const totals = foodTotals(food);
          return <div className="review-item" key={item.key}>
            <div className="review-row">
              <span className={`tile-icon ${totals ? "ink-lime" : "ink-amber"}`}><Icon name={totals ? "food" : "info"} size={17}/></span>
              <div className="review-name"><strong>{name}</strong><small>{portionText(food, language)} · {t(sourceLabel(food))}
                {food.estimatedPortion && food.spec?.source !== "estimate" ? ` ${t("· 估算份量")}` : ""}</small></div>
              {totals && <strong className="inline-kcal">{whole.format(totals.total.kcal)} <small>kcal</small></strong>}
              <IconButton icon="edit" label={t`核对 ${name}`} onClick={() => setEditor({ item, label: false })}/>
              {!entryId && <IconButton icon="close" label={t`移除 ${name}`} onClick={() => setItems((before) => before.filter(({ key }) => key !== item.key))}/>}
            </div>
            {totals ? <p className="review-detail">
              {t("蛋白质")} {number.format(totals.total.protein)} {t("g · 碳水")} {number.format(totals.total.carbs)} {t("g · 脂肪")} {number.format(totals.total.fat)} g
              {totals.bounds && <span> {t("· 估算")} {whole.format(totals.bounds.low.kcal)}–{whole.format(totals.bounds.high.kcal)} kcal</span>}
              {food.spec?.fdcId && <> · <a className="text-link" target="_blank" rel="noreferrer" href={fdcLink(food.spec.fdcId)}>{t("来源")}</a></>}
            </p> : <div className="review-detail">
              <p>{t(food.note || "请核对单位或补充克重和营养。")}</p>
              {!entryId && <button type="button" className="text-link" onClick={() => {
                setTab("search"); setSearch(food.lookup || food.name); setReplace(item.key); setOnline([]); setMessage("");
              }}>{t("匹配食物")}</button>}
            </div>}
            {food.note && totals && <p className="review-detail">{t(food.note)}</p>}
            {food.photoRange && <p className="review-detail">{t("照片无法称重，请核对份量、油和酱料。")}</p>}
          </div>;
        })}
      </div>}
    </>}
  </Modal>;
}
