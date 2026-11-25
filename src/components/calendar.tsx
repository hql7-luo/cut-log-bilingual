"use client";

import { useLanguage } from "./language";
import { useMemo, useState } from "react";
import { calendarDays, calendarPeriod, calendarStats, CALENDAR_VIEWS, shiftMonth, type CalendarDayStats, type CalendarView } from "../lib/calendar";
import { dayIndex, dateTitle, monthTitle, shiftDay, weekStart } from "../lib/dates";
import type { Translate } from "../lib/locale";
import { ACTIVITY_LABELS, recordsOf, type Profile, type Row } from "../lib/model";
import { whole } from "../lib/nutrition";
import { FoodList, TrainingEstimateNotes, WorkoutList } from "./dashboard";
import { Button, Modal } from "./ui";

const viewLabels: Record<CalendarView, string> = { week: "周", month: "月", quarter: "季度" };
const weekdays = { zh: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] };
type CalendarProps = { rows: Row[]; profile: Profile; today: string; addFood: (day: string) => void };
type CalendarCell = { day: string; label: string; value?: string; caption?: string; tone?: "deficit" | "surplus" | "recorded" };

function balanceKind(shortfall: number) {
  if (Math.round(Math.abs(shortfall)) === 0) return "持平";
  return shortfall > 0 ? "缺口" : "盈余";
}

// Daily details keep the intake target below the three main figures.
function EnergyFigures({ intake, target, expenditure, shortfall }: {
  intake: number | null; target?: number | null; expenditure: number | null; shortfall: number | null;
}) {
  const { t } = useLanguage();
  const daily = target === undefined;
  const balance = shortfall === null ? "缺口" : balanceKind(shortfall);
  const metrics = [
    { label: "已记摄入", value: intake },
    ...(target === undefined ? [] : [{ label: "摄入目标", value: target }]),
    { label: "估算消耗", value: expenditure },
    { label: `估算${balance}`, value: shortfall === null ? null : Math.abs(shortfall) },
  ];
  return <dl className={`calendar-figures${daily ? " day-figures" : ""}`}>{metrics.map(({ label, value }) => <div key={label}>
    <dt>{t(label)}</dt><dd>{value === null ? "—" : <>{whole.format(value)} <small>kcal</small></>}</dd>
  </div>)}</dl>;
}

function PeriodHeading({ label, canAdvance, move, insideDialog = false }: {
  label: string; canAdvance: boolean; move: (amount: number) => void; insideDialog?: boolean;
}) {
  const { t } = useLanguage();
  const Heading = insideDialog ? "h3" : "h2";
  return <div className="calendar-heading">
    <button type="button" className="icon-button calendar-arrow" aria-label={t("上一周期")} onClick={() => move(-1)}>‹</button>
    <Heading>{label}</Heading>
    <button type="button" className="icon-button calendar-arrow" aria-label={t("下一周期")} disabled={!canAdvance} onClick={() => move(1)}>›</button>
  </div>;
}

// Date pickers for food history show the amount logged.
function intakeCell({ day, kcal }: CalendarDayStats, t: Translate): CalendarCell {
  if (kcal === null) return { day, label: t("未记饮食") };
  const value = whole.format(kcal);
  return { day, label: t`${t("已记摄入")}，${value} 千卡`, value, caption: t("摄入"), tone: "recorded" };
}

// Only label a deficit or surplus for a date with both intake and estimated burn.
function balanceCell({ day, kcal, shortfall }: CalendarDayStats, t: Translate): CalendarCell {
  if (kcal === null) return { day, label: t("未记饮食") };
  if (shortfall === null) return { day, label: t("已记饮食，热量差待估算"), caption: t("待估算"), tone: "recorded" };
  const kind = balanceKind(shortfall);
  const value = whole.format(Math.abs(shortfall));
  return { day, label: t`${t(`估算${kind}`)}，${value} 千卡`, value, caption: t(kind),
    tone: kind === "缺口" ? "deficit" : kind === "盈余" ? "surplus" : "recorded" };
}

function CalendarGrid({ days, selected, today, monthLabel, select }: {
  days: CalendarCell[]; selected: string; today: string; monthLabel?: string; select: (day: string) => void;
}) {
  const { language, t } = useLanguage();
  const first = days[0].day;
  const offset = dayIndex(first) - dayIndex(weekStart(first));
  return <section className="calendar-month" aria-label={monthLabel ?? t("日期")}>
    {monthLabel && <h3>{monthLabel}</h3>}
    <div className="calendar-grid">
      {weekdays[language].map((weekday) => <span className="calendar-weekday" key={weekday}>{weekday}</span>)}
      {Array.from({ length: offset }, (_, index) => <span aria-hidden="true" key={`blank-${index}`}/>)}
      {days.map(({ day, label, value, caption, tone }) => {
        const future = day > today;
        return <button type="button" key={day} aria-pressed={day === selected} disabled={future}
          aria-current={day === today ? "date" : undefined}
          aria-label={future ? day : `${day}${language === "zh" ? "，" : ", "}${label}`} className={`calendar-day ${tone ?? ""}`} onClick={() => select(day)}>
          <strong>{Number(day.slice(8, 10))}</strong>
          {value && <small>{value}</small>}
          {caption && <span>{caption}</span>}
        </button>;
      })}
    </div>
  </section>;
}

// Home and the calendar share the same daily totals and underlying records.
function CalendarDayDetails({ active, rows, addFood, close }: {
  active: CalendarDayStats; rows: Row[]; addFood: (day: string) => void; close: () => void;
}) {
  const { language, t } = useLanguage();
  const foods = recordsOf(rows, "food").filter(({ payload }) => payload.day === active.day);
  const workouts = recordsOf(rows, "workout").filter(({ payload }) => payload.day === active.day)
    .sort((a, b) => b.payload.time - a.payload.time);
  const energy = active.energy;
  return <Modal title={dateTitle(active.day, language)} wide close={close} footer={
    <Button icon="plus" variant="primary" onClick={() => addFood(active.day)}>{t("记当天饮食")}</Button>
  }>
    <EnergyFigures intake={active.kcal} expenditure={active.expenditure} shortfall={active.shortfall}/>
    <p className="fine calendar-goal">{t`摄入目标 ${whole.format(active.target)} kcal · ${t(ACTIVITY_LABELS[active.activity])}日`}</p>
    {active.shortfall !== null && <p className="fine">{t("按已记录摄入估算")}</p>}
    <TrainingEstimateNotes energy={energy} target={active.target} expanded/>
    <div className="calendar-logs">
      <section aria-labelledby="calendar-day-workouts">
        <h3 id="calendar-day-workouts">{t("训练记录")}</h3>
        {workouts.length ? <WorkoutList rows={workouts} showDetails/> : <p className="fine">{t("当天没有训练记录。")}</p>}
      </section>
      <section aria-labelledby="calendar-day-foods">
        <h3 id="calendar-day-foods">{t("饮食记录")}</h3>
        {foods.length ? <FoodList rows={foods} mealHeading="h4"/> : <p className="fine">{t("当天没有饮食记录。")}</p>}
      </section>
    </div>
  </Modal>;
}

export function MonthDatePicker({ rows, profile, today, selected, mode, select, close }: Omit<CalendarProps, "addFood"> & {
  selected: string; mode: "food" | "training" | "balance"; select: (day: string) => void; close: () => void;
}) {
  const { language, t } = useLanguage();
  const [month, setMonth] = useState(selected);
  const { start, end, label } = calendarPeriod(month, "month", language);
  const days = useMemo(() => {
    if (mode !== "training") {
      const cell = mode === "balance" ? balanceCell : intakeCell;
      return calendarStats(rows, profile, start, end, today).days.map((day) => cell(day, t));
    }
    const counts = new Map<string, number>();
    for (const { payload: { day } } of recordsOf(rows, "workout")) {
      if (day >= start && day <= end && day <= today) counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return calendarDays(start, end).map((day): CalendarCell => {
      const count = counts.get(day);
      return count ? { day, label: t`${count} 项训练`, caption: t`${count} 项`, tone: "recorded" } : { day, label: t("未记训练") };
    });
  }, [mode, rows, profile, start, end, today, t]);
  return <Modal title={t("选择日期")} close={close}>
    <PeriodHeading label={label} canAdvance={end < today} insideDialog move={(amount) => setMonth(shiftMonth(start, amount))}/>
    {mode === "balance" && <p className="fine">{t("每日估算缺口或盈余（kcal）")}</p>}
    <CalendarGrid days={days} selected={selected} today={today} select={select}/>
  </Modal>;
}

export function CalendarPage({ rows, profile, today, addFood }: CalendarProps) {
  const { language, t } = useLanguage();
  const [view, setView] = useState<CalendarView>("month");
  const [selected, setSelected] = useState(today);
  const [detailOpen, setDetailOpen] = useState(false);
  const { start, end, label } = calendarPeriod(selected, view, language);
  const stats = useMemo(() => calendarStats(rows, profile, start, end, today), [rows, profile, start, end, today]);
  const active = stats.days.find(({ day }) => day === selected) ?? stats.days[0];
  const months = view === "quarter"
    ? [0, 1, 2].map((offset) => stats.days.filter(({ day }) => day.startsWith(shiftMonth(start, offset).slice(0, 7))))
    : [stats.days];

  function move(amount: number) {
    const next = view === "week" ? shiftDay(start, amount * 7) : shiftMonth(start, amount * (view === "quarter" ? 3 : 1));
    setSelected(next > today ? today : next);
  }

  return <div className="calendar-page">
    <section className="card padded calendar-period">
      <div className="calendar-toolbar">
        <div className="segments compact" role="group" aria-label={t("日历周期")}>
          {CALENDAR_VIEWS.map((value) => <button type="button" key={value} aria-pressed={view === value}
            onClick={() => setView(value)}>{t(viewLabels[value])}</button>)}
        </div>
        <Button variant="quiet" onClick={() => setSelected(today)}>{t("今天")}</Button>
      </div>
      <PeriodHeading label={label} canAdvance={end < today} move={move}/>
      <EnergyFigures intake={stats.recorded ? stats.consumed : null} target={stats.recorded ? stats.target : null}
        expenditure={stats.expenditure} shortfall={stats.shortfall}/>
      <p className="fine">{t`已记 ${stats.recorded} / ${stats.elapsed} 天。合计按有饮食记录的日期计算。`} {" "}
        {stats.days.some((day) => day.kcal !== null && day.expenditure !== null && day.energy?.fromSelection) && t("含今天的手选活动预估。")}</p>
      {stats.missingDuration > 0 && <p className="fine">{t`其中 ${stats.missingDuration} 项训练补填时长后会计入消耗。`}</p>}
      {!profile.age && <a href="#settings" className="text-link">{t("填写年龄后查看消耗和缺口")}</a>}
    </section>
    <section className="card padded" aria-label={t("每日热量差日历")}>
      <p className="fine">{t("每日估算缺口或盈余（kcal）")}</p>
      <div className={view === "quarter" ? "calendar-quarter" : ""}>
        {months.map((days) => <CalendarGrid key={days[0].day} days={days.map((day) => balanceCell(day, t))} selected={selected} today={today}
          monthLabel={view === "quarter" ? monthTitle(days[0].day, language) : undefined}
          select={(day) => { setSelected(day); setDetailOpen(true); }}/>)}
      </div>
    </section>
    {detailOpen && <CalendarDayDetails active={active} rows={rows} close={() => setDetailOpen(false)}
      addFood={(day) => { setDetailOpen(false); addFood(day); }}/>}
  </div>;
}
