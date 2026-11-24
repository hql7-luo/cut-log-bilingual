"use client";

import { LanguageProvider, useLanguage } from "./language";
import { useEffect, useMemo, useRef, useState } from "react";
import { calendarStats } from "../lib/calendar";
import { compactDay, dateTitle, isDay, shiftDay } from "../lib/dates";
import { downloadCsv } from "../lib/export";
import { DEFAULT_PROFILE, makeId, recordsOf, type Activity, type Change,
  type FoodDraft, type LogRow, type Meal, type Profile, type Row } from "../lib/model";
import { foodTotals, normalize, sum, whole } from "../lib/nutrition";
import { CLOUD_ENABLED } from "../lib/public-config";
import { useCloudAuth, useToday, useTracker } from "../lib/use-tracker";
import { Dashboard, FoodList } from "./dashboard";
import { CalendarPage, HomeDatePicker, MonthDatePicker } from "./calendar";
import { FoodModal, type Providers } from "./food-modal";
import { ProgressPage, WeightModal } from "./progress";
import { SettingsPage, type Theme } from "./settings";
import { TrainingPage, WorkoutModal } from "./training";
import { Button, CardHead, Empty, Icon, IconButton, type IconName } from "./ui";

const nav = [
  { id: "today", label: "总览", title: "今日总览", icon: "home" },
  { id: "food", label: "饮食", title: "饮食记录", icon: "food" },
  { id: "training", label: "训练", title: "训练记录", icon: "lift" },
  { id: "progress", label: "进度", title: "减脂进度", icon: "chart" },
  { id: "calendar", label: "日历", title: "热量日历", icon: "calendar" },
  { id: "settings", label: "设置", title: "个人设置", icon: "settings" },
] as const satisfies { id: string; label: string; title: string; icon: IconName }[];
type Page = typeof nav[number]["id"];
const offline: Providers = { ai: false, usda: false, vision: false };

type FoodDialog = { kind: "food"; day: string; meal?: Meal; items?: FoodDraft[]; keepDay?: boolean; row?: LogRow<"food"> };
type Dialog = FoodDialog
  | { kind: "training"; day?: string; row?: LogRow<"workout"> } | { kind: "weight"; row?: LogRow<"weight"> } | { kind: "date-picker" };

function mountName() {
  const hash = window.location.hash.slice(1);
  return nav.find(({ id }) => id === hash)?.id ?? "today";
}

function Brand() {
  const { t } = useLanguage();
  return <a className="brand" href="#today" aria-label={t("减脂日志首页")}>
    <span className="brand-icon"><Icon name="pulse" size={25}/></span><strong>{t("减脂日志")}</strong>
  </a>;
}

function LanguageSwitch() {
  const { language, setLanguage } = useLanguage();
  const next = language === "zh" ? "en" : "zh";
  return <button type="button" className="language-switch" aria-label={next === "en" ? "Switch to English" : "Switch to Chinese"}
    onClick={() => setLanguage(next)}><span lang={next === "en" ? "en" : "zh-CN"}>{next === "en" ? "English" : "中文"}</span></button>;
}

// Only the chosen day is rendered, regardless of how many dates have records.
function FoodHistory({ today, day, rows, presets, open, edit, remove, copy, deletePreset, showToday }: {
  today: string; day: string; rows: LogRow<"food">[]; presets: LogRow<"food_preset">[];
  open: (date: string) => void; edit: (row: LogRow<"food">) => void; remove: (row: LogRow<"food">) => void;
  copy: (meal: Meal, rows: LogRow<"food">[]) => void; deletePreset: (row: LogRow<"food_preset">) => void; showToday: () => void;
}) {
  const { t } = useLanguage();
  const label = day === today ? t("今天") : day === shiftDay(today, -1) ? t("昨天") : compactDay(day);
  const entries = rows.filter(({ payload }) => payload.day === day);
  const total = sum(entries.flatMap(({ payload }) => foodTotals(payload)?.total ?? []));
  return <div className="subpage-grid">
    <section className="card padded">
      <CardHead title={t`${label}的饮食`} icon="bowl">
        {day !== today && <button type="button" className="text-link return-today" onClick={showToday}>{t("回到今天")}</button>}
      </CardHead>
      {entries.length ? <>
        <div className="history-totals"><strong>{whole.format(total.kcal)} kcal</strong>
          <span>{t("蛋白质")} {whole.format(total.protein)} {t("g · 碳水")} {whole.format(total.carbs)} {t("g · 脂肪")} {whole.format(total.fat)} g</span></div>
        <FoodList rows={entries} onEdit={edit} onDelete={remove} onCopy={day === today ? undefined : copy}/>
      </> : <Empty title={t("这一天还没有记录。")} icon="bowl"/>}
      <Button icon="plus" onClick={() => open(day)}>{t`添加到${label}`}</Button>
    </section>
    <section className="card padded">
      <CardHead title={t("常吃食物")} icon="star"/>
      {presets.length ? presets.map((preset) => <div key={preset.id} className="history-row">
        <span>{t(preset.payload.spec.name)}</span>
        <IconButton icon="trash" label={t`删除常吃 ${t(preset.payload.spec.name)}`} onClick={() => deletePreset(preset)}/>
      </div>) : <p className="muted">{t("编辑食物时可保存为常吃，之后快速添加。")}</p>}
    </section>
  </div>;
}

export default function TrackerApp() {
  return <LanguageProvider><Tracker/></LanguageProvider>;
}

function Tracker() {
  const { language, t } = useLanguage();
  const today = useToday();
  const auth = useCloudAuth();
  const store = useTracker(today, auth);
  const [page, setPage] = useState<Page>("today");
  const [recordDay, setRecordDay] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: Change[] } | null>(null);
  const [providerFlags, setProviderFlags] = useState<Providers>(offline);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const change = () => {
      setPage(mountName());
      setRecordDay(null);
      setDialog((current) => current?.kind === "date-picker" ? null : current);
      window.scrollTo({ top: 0 });
    };
    change();
    window.addEventListener("hashchange", change);
    let appearance: Theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    try {
      const saved = localStorage.getItem("cut-log:theme");
      if (saved === "light" || saved === "dark") appearance = saved;
    } catch { /* The device appearance remains available. */ }
    document.documentElement.dataset.theme = appearance;
    setTheme(appearance);
    return () => window.removeEventListener("hashchange", change);
  }, []);

  useEffect(() => {
    if (auth.ready) setPage(mountName());
  }, [auth.ready]);

  useEffect(() => {
    if (!CLOUD_ENABLED || !auth.session?.user.id) return;
    let active = true;
    fetch("/api/providers", { cache: "no-store" }).then((response) => response.ok ? response.json() : offline)
      .then((value) => { if (active) setProviderFlags(value); }).catch(() => {});
    return () => { active = false; };
  }, [auth.session?.user.id]);

  const scope = auth.session?.user.id ?? "guest";
  useEffect(() => { setDialog(null); setToast(null); setRecordDay(null); }, [scope]);

  const themeChange = (next: Theme) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("cut-log:theme", next); } catch { }
  };

  function notify(text: string, undo?: Change[]) {
    if (timer.current) clearTimeout(timer.current);
    setToast({ text, undo });
    timer.current = setTimeout(() => setToast(null), undo ? 12_000 : 4500);
  }

  const openFood = (day = today, options?: Pick<FoodDialog, "meal" | "items" | "keepDay">) =>
    setDialog({ kind: "food", day, ...options });
  const addFoodOnDate = (day: string) => openFood(day, { keepDay: true });
  const editFood = (row: LogRow<"food">) => setDialog({
    kind: "food", row, day: row.payload.day, meal: row.payload.meal, items: [row.payload],
  });
  const addWorkout = (day = today) => setDialog({ kind: "training", day });
  const addWeight = () => setDialog({ kind: "weight" });
  const editWorkout = (row: LogRow<"workout">) => setDialog({ kind: "training", row });
  const editWeight = (row: LogRow<"weight">) => setDialog({ kind: "weight", row });
  const close = () => setDialog(null);

  async function remove(row: Row) {
    try {
      await store.save([{ kind: row.kind, id: row.id, payload: null }]);
      notify("已删除记录。", [row]);
    } catch (error) { notify((error as Error).message); }
  }

  async function saveProfile(profile: Profile) {
    await store.save([{ kind: "profile", id: "personal", payload: profile }]);
    notify("已保存设置。");
  }

  async function changeActivity(activity: Activity | null) {
    try { await store.save([{ kind: "activity", id: today, payload: activity ? { day: today, activity } : null }]); }
    catch (error) { notify((error as Error).message); }
  }

  const foods = useMemo(() => recordsOf(store.rows, "food").sort((a, b) => b.payload.day.localeCompare(a.payload.day) || b.payload.time - a.payload.time), [store.rows]);
  const workouts = useMemo(() => recordsOf(store.rows, "workout"), [store.rows]);
  const weights = useMemo(() => recordsOf(store.rows, "weight"), [store.rows]);
  const presets = useMemo(() => recordsOf(store.rows, "food_preset"), [store.rows]);
  const workoutPresets = useMemo(() => recordsOf(store.rows, "workout_preset"), [store.rows]);
  const manual = recordsOf(store.rows, "activity").find(({ id }) => id === today)?.payload.activity;
  const latest = [...weights].filter((row) => !row.sample).sort((a, b) => b.payload.day.localeCompare(a.payload.day))[0]?.payload.kg;
  const exampleProfile = useMemo(() => ({ ...DEFAULT_PROFILE, goalDay: shiftDay(today, 84) }), [today]);
  const profile = recordsOf(store.rows, "profile")[0]?.payload ?? exampleProfile;
  const todayStats = useMemo(() => calendarStats(store.rows, profile, today, today, today).days[0], [store.rows, profile, today]);
  const hasSamples = store.rows.some((row) => row.sample);
  const session = auth.session;
  const providers = session ? providerFlags : offline;
  const recordsPage = page === "food" || page === "training" ? page : null;
  const viewedDay = recordsPage ? recordDay ?? today : today;
  const selectDay = (day: string) => setRecordDay(day);
  const status = !store.ready ? "载入中" : session ? store.problem ? "同步暂停" :
    Object.keys(store.snapshot.conflicts).length ? "待处理冲突" : store.snapshot.pending.length ? "待同步" :
      store.snapshot.pulled ? "已同步" : "连接云端" : hasSamples ? "示例数据" : "本机记录";

  return <div className="app-shell">
    <a href="#main" className="skip" onClick={(event) => {
      event.preventDefault();
      document.getElementById("main")?.focus();
    }}>{t("跳到内容")}</a>
    <aside className="sidebar">
      <Brand/>
      <nav aria-label={t("主导航")}>{nav.map(({ id, label, icon }) =>
        <a href={`#${id}`} key={id} aria-current={page === id ? "page" : undefined}><Icon name={icon}/><span>{t(label)}</span></a>)}</nav>
      <div className="sidebar-bottom">
        <LanguageSwitch/>
        <button type="button" className="sidebar-theme" onClick={() => themeChange(theme === "dark" ? "light" : "dark")}>
          <Icon name={theme === "dark" ? "sun" : "moon"} size={18}/>{theme === "dark" ? t("浅色模式") : t("深色模式")}
        </button>
      </div>
    </aside>
    <header className="mobile-bar"><Brand/>
      <div className="inline-actions">
        <LanguageSwitch/>
        <button type="button" className="icon-button" aria-label={theme === "dark" ? t("切换浅色") : t("切换深色")}
          onClick={() => themeChange(theme === "dark" ? "light" : "dark")}><Icon name={theme === "dark" ? "sun" : "moon"}/></button>
      </div>
    </header>
    <main className="main" id="main" tabIndex={-1}>
      <div className="page-heading">
        <div>
          {(page === "today" || recordsPage) && <button type="button" className="date-label" aria-label={t("选择日期")} aria-haspopup="dialog"
            disabled={!store.ready} onClick={() => setDialog({ kind: "date-picker" })}>
            <Icon name="calendar" size={17}/><span suppressHydrationWarning>{dateTitle(viewedDay, language)}</span><Icon name="down" size={15}/>
          </button>}
          <div className="page-title"><h1>{t(nav.find(({ id }) => id === page)!.title)}</h1>
            <a className={`state-chip ${hasSamples ? "sample-chip" : ""}`} href="#settings"><span/>{t(status)}</a></div>
        </div>
        {page !== "settings" && <div className="page-actions">
          {(page === "today" || page === "food") && <Button variant="primary" icon="plus" disabled={!store.ready}
            onClick={() => openFood(viewedDay, { keepDay: Boolean(recordDay) })}>{t("记录饮食")}</Button>}
          {(page === "today" || page === "training") && <Button variant={page === "today" ? "secondary" : "primary"} icon="plus"
            disabled={!store.ready} onClick={() => addWorkout(viewedDay)}>{t("记录训练")}</Button>}
          {page === "progress" && <Button variant="primary" icon="plus" disabled={!store.ready} onClick={addWeight}>{t("记录体重")}</Button>}
        </div>}
      </div>
      {store.volatile && <p className="notice storage-notice">{t("浏览器仅允许临时保存。关闭页面前可在设置中导出 CSV。")}</p>}
      {!store.ready ? <div className="card loading-card" role="status">{t(store.problem || "正在载入记录…")}</div> : <>
        {page === "today" && <Dashboard today={today} profile={profile} dayStats={todayStats} manualActivity={Boolean(manual)}
          foods={foods} workouts={workouts} weights={weights} onActivity={changeActivity} onFood={() => openFood()} onWeight={addWeight}
          onFoodEdit={editFood} onFoodDelete={remove} onWorkoutEdit={editWorkout} onWorkoutDelete={remove}/>}
        {page === "food" && <FoodHistory today={today} day={viewedDay} showToday={() => selectDay(today)}
          rows={foods} presets={presets} open={addFoodOnDate} edit={editFood} remove={remove}
          copy={(meal, items) => openFood(today, { meal, items: items.map(({ payload }) => payload), keepDay: true })} deletePreset={remove}/>}
        {page === "training" && <TrainingPage today={today} day={viewedDay} selectDay={selectDay} rows={workouts} presets={workoutPresets} edit={editWorkout}
          add={addWorkout} remove={remove} deletePreset={remove}/>}
        {page === "progress" && <ProgressPage today={today} rows={weights} profile={profile} add={addWeight}
          edit={editWeight} remove={remove} confirm={saveProfile}/>}
        {page === "calendar" && <CalendarPage rows={store.rows} profile={profile} today={today} addFood={addFoodOnDate}/>}
        {page === "settings" && <SettingsPage profile={profile} latest={latest} theme={theme} setTheme={themeChange} auth={auth}
          store={store} providers={providers} save={saveProfile} exportData={() => downloadCsv(store.rows, today, language)}
          clearSamples={async () => { await store.discardExamples(); notify("示例已移除，可以开始记录。"); }}
          hasSamples={hasSamples} message={notify}/>}
      </>}
    </main>
    <nav className="bottom-nav" aria-label={t("手机导航")}>{nav.map(({ id, label, icon }) =>
      <a href={`#${id}`} key={id} aria-current={page === id ? "page" : undefined}><Icon name={icon} size={21}/><span>{t(label)}</span></a>)}</nav>
    {dialog?.kind === "date-picker" && (recordsPage ? <MonthDatePicker rows={store.rows} profile={profile} today={today}
      mode={recordsPage} selected={viewedDay} close={close} select={(day) => { selectDay(day); close(); }}/>
      : <HomeDatePicker rows={store.rows} profile={profile} today={today} close={close} addFood={addFoodOnDate}/>)}
    {dialog?.kind === "food" && <FoodModal today={today} date={dialog.day} keepDay={dialog.keepDay} initialMeal={dialog.meal} initial={dialog.items}
      entryId={dialog.row?.id} favorites={presets} history={foods.slice(0, 90)} providers={providers} getToken={auth.token} close={close}
      setFavorite={async (food) => {
        if (!food.spec) return;
        const previous = presets.find(({ payload }) => normalize(payload.spec.name) === normalize(food.name));
        await store.save([{ kind: "food_preset", id: previous?.id ?? makeId(),
          payload: { spec: { ...food.spec, name: food.name }, amount: food.amount, unit: food.unit, grams: food.grams } }]);
        notify("已保存常吃食物。");
      }}
      save={async (entries, day, meal) => {
        if (!isDay(day) || day > today || !entries.length || entries.some((entry) => !foodTotals(entry))) throw new Error("请检查日期和营养信息。");
        const old = dialog.row;
        const changes = entries.map((entry, index): Change<"food"> => ({ kind: "food", id: old?.id ?? makeId(),
          payload: { ...entry, day, meal, time: old?.payload.time ?? Date.now() + index }, sample: old?.sample }));
        await store.save(changes);
        close();
        notify(old ? "已更新饮食记录。" : t`已记录 ${entries.length} 项食物。`, old
          ? [old]
          : changes.map(({ kind, id }) => ({ kind, id, payload: null })));
      }}/>}
    {dialog?.kind === "training" && <WorkoutModal today={today} date={dialog.day} initial={dialog.row} presets={workoutPresets} close={close}
      save={async (workout, preset) => {
        if (!isDay(workout.day) || workout.day > today) throw new Error("请选择有效的训练日期。");
        const old = dialog.row;
        const id = old?.id ?? makeId();
        const changes: Change[] = [{ kind: "workout", id, payload: workout, sample: old?.sample }];
        const undo: Change[] = [old ?? { kind: "workout", id, payload: null }];
        if (preset) {
          const previous = workoutPresets.find(({ payload }) => normalize(payload.name) === normalize(preset.name));
          const presetId = previous?.id ?? makeId();
          changes.push({ kind: "workout_preset", id: presetId, payload: preset });
          undo.push(previous ?? { kind: "workout_preset", id: presetId, payload: null });
        }
        await store.save(changes);
        close();
        notify("训练已保存。", undo);
      }}/>}
    {dialog?.kind === "weight" && <WeightModal today={today} initial={dialog.row} close={close} save={async (day, kg) => {
      if (!isDay(day) || day > today || !Number.isFinite(kg) || kg < 25 || kg > 500) throw new Error("请检查日期和体重。");
      const before = weights.find(({ id }) => id === day);
      await store.save([{ kind: "weight", id: day, payload: { day, kg }, sample: dialog.row?.sample }]);
      close();
      notify("体重已保存。", [before ?? { kind: "weight", id: day, payload: null }]);
    }}/>}
    {toast && <div className="toast" role="status"><Icon name="info" size={17}/><span>{t(toast.text)}</span>
      {toast.undo && <button type="button" className="text-link" onClick={async () => {
        const undo = toast.undo;
        if (!undo) return;
        try { await store.save(undo); notify("已撤销。"); } catch (error) { notify((error as Error).message); }
      }}>{t("撤销")}</button>}
      <IconButton label={t("关闭提示")} icon="close" onClick={() => setToast(null)}/>
    </div>}
  </div>;
}
