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
type CalendarCell = { day: string; label: string; value?: string; caption?: string; tone?: "over" | "within" | "recorded" };

// Daily details keep the intake target below the three main figures.
function EnergyFigures({ intake, target, expenditure, shortfall }: {
  intake: number | null; target?: number | null; expenditure: number | null; shortfall: number | null;
}) {
  const { t } = useLanguage();
  const daily = target === undefined;
  const surplus = daily && shortfall !== null && shortfall < 0;
  const metrics = [
    { label: "已记摄入", value: intake },
    ...(target === undefined ? [] : [{ label: "摄入目标", value: target }]),
    { label: "估算消耗", value: expenditure },
    { label: surplus ? "估算盈余" : "估算缺口", value: surplus ? Math.abs(shortfall) : shortfall },
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

// Keep the food and workout calendars in the same grid, with markers specific to each page.
function intakeCell({ day, kcal, overTarget }: CalendarDayStats, t: Translate): CalendarCell {
  if (kcal === null) return { day, label: t("未记饮食") };
  const caption = t(overTarget ? "超目标" : "目标内");
  return { day, label: t`${caption}，${whole.format(kcal)} 千卡`, value: String(Math.round(kcal)), caption,
    tone: overTarget ? "over" : "within" };
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
    <TrainingEstimateNotes energy={energy} expanded/>
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
  selected: string; mode: "food" | "training"; select: (day: string) => void; close: () => void;
}) {
  const { language, t } = useLanguage();
  const [month, setMonth] = useState(selected);
  const { start, end, label } = calendarPeriod(month, "month", language);
  const days = useMemo(() => {
    if (mode === "food") return calendarStats(rows, profile, start, end, today).days.map((day) => intakeCell(day, t));
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
    <CalendarGrid days={days} selected={selected} today={today} select={select}/>
  </Modal>;
}

export function HomeDatePicker({ rows, profile, today, addFood, close }: CalendarProps & { close: () => void }) {
  const [selected, setSelected] = useState(today);
  const [detailOpen, setDetailOpen] = useState(false);
  if (detailOpen) {
    const active = calendarStats(rows, profile, selected, selected, today).days[0];
    return <CalendarDayDetails active={active} rows={rows} addFood={addFood} close={() => setDetailOpen(false)}/>;
  }
  return <MonthDatePicker mode="food" rows={rows} profile={profile} today={today} selected={selected} close={close}
    select={(day) => { setSelected(day); setDetailOpen(true); }}/>;
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
      <p className="fine">{t`已记 ${stats.recorded} / ${stats.elapsed} 天 · ${stats.overTarget} 天超目标。合计按有记录的日期计算。`} {" "}
        {stats.days.some((day) => day.kcal !== null && day.expenditure !== null && day.energy?.fromSelection) && t("含今天的手选活动预估。")}</p>
      {stats.missingDuration > 0 && <p className="fine">{t`其中 ${stats.missingDuration} 项训练补填时长后会计入消耗。`}</p>}
      {!profile.age && <a href="#settings" className="text-link">{t("填写年龄后查看消耗和缺口")}</a>}
    </section>
    <section className="card padded" aria-label={t("每日摄入日历")}>
      <div className={view === "quarter" ? "calendar-quarter" : ""}>
        {months.map((days) => <CalendarGrid key={days[0].day} days={days.map((day) => intakeCell(day, t))} selected={selected} today={today}
          monthLabel={view === "quarter" ? monthTitle(days[0].day, language) : undefined}
          select={(day) => { setSelected(day); setDetailOpen(true); }}/>)}
      </div>
    </section>
    {detailOpen && <CalendarDayDetails active={active} rows={rows} close={() => setDetailOpen(false)}
      addFood={(day) => { setDetailOpen(false); addFood(day); }}/>}
  </div>;
}
