"use client";

import { useLanguage } from "./language";
import type { Translate } from "../lib/locale";
import { useState } from "react";
import { compactDay } from "../lib/dates";
import { ACTIVITIES, ACTIVITY_LABELS, dailyTarget, type LogRow, type Profile } from "../lib/model";
import { number, whole } from "../lib/nutrition";
import { trend, trendReview } from "../lib/trends";
import { Button, CardHead, Empty, ErrorText, Field, IconButton, Modal } from "./ui";
import { WeightPlot } from "./weight-plot";

export function WeightModal({ today, initial, save, close }: {
  today: string; initial?: LogRow<"weight">; save: (day: string, kg: number) => Promise<void>; close: () => void;
}) {
  const { t } = useLanguage();
  const [day, setDay] = useState(initial?.payload.day ?? today);
  const [value, setValue] = useState(initial ? String(initial.payload.kg) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try { await save(day, Number(value)); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title={initial ? t("编辑体重") : t("记录体重")} close={close} footer={
    <Button variant="primary" icon="check" type="submit" form="weight-form" disabled={busy}>{busy ? t("正在保存…") : t("保存体重")}</Button>
  }>
    <form id="weight-form" className="form-stack" onSubmit={submit}>
      <Field label={t("日期")}><input required type="date" max={today} disabled={Boolean(initial)} value={day} onChange={(e) => setDay(e.target.value)}/></Field>
      <Field label={t("体重（kg）")}><input autoFocus type="number" inputMode="decimal" required min="25" max="500" step=".01"
        value={value} placeholder="78.0" onChange={(e) => setValue(e.target.value)}/></Field>
      <ErrorText>{error}</ErrorText>
    </form>
  </Modal>;
}

function rateText(rate: number | null, t: Translate) {
  if (rate === null) return t("数据不足");
  if (Math.abs(rate) < 0.05) return t("持平");
  return t`${t(rate > 0 ? "下降" : "上升")} ${number.format(Math.abs(rate))} kg/周`;
}

export function ProgressPage({ today, rows, profile, add, edit, remove, confirm }: {
  today: string; rows: LogRow<"weight">[]; profile: Profile; add: () => void; edit: (row: LogRow<"weight">) => void;
  remove: (row: LogRow<"weight">) => void; confirm: (profile: Profile) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [days, setDays] = useState(30);
  const [visible, setVisible] = useState(12);
  const [adjust, setAdjust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const actual = rows.map(({ payload }) => payload);
  const stats = trend(actual, today, profile);
  const review = trendReview(rows.filter((row) => !row.sample).map(({ payload }) => payload), today, profile);
  const kcal = review?.adjustment ?? 0;
  const shifted = Object.fromEntries(ACTIVITIES.map((activity) => [activity, profile.calories[activity] + kcal])) as Profile["calories"];
  const adjustedProfile = { ...profile, calories: shifted };
  const canAdjust = kcal !== 0 && Object.values(shifted).every((target) => target >= Math.max(1000, profile.protein * 4 + profile.fat * 9));
  async function handleReview(apply: boolean) {
    if (!review?.day || busy) return;
    setBusy(true);
    setError("");
    try {
      await confirm({ ...(apply ? adjustedProfile : profile), handledReview: review.day });
      setAdjust(false);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="progress-layout">
    <section className="card padded">
      <CardHead title={t("体重变化")} icon="chart"><div className="segments compact" role="group" aria-label={t("体重图时间范围")}>
        {[14, 30, 90].map((value) => <button key={value} type="button" aria-pressed={value === days} onClick={() => setDays(value)}>{value} {t("天")}</button>)}
      </div></CardHead>
      <div className="progress-stats">
        <div><span>{t("最新体重")}</span><strong>{number.format(stats.current)} <small>kg</small></strong>
          <small>{stats.latest ? t`${compactDay(stats.latest.day)} 实测` : t("设置体重")}</small></div>
        <div><span>{t("7 日平均")}</span><strong>{stats.recent ? number.format(stats.recent.kg) : "—"} <small>kg</small></strong>
          <small>{stats.recent ? t`近 7 天记录 ${stats.recent.coverage} 次` : t("等待记录")}</small></div>
        <div><span>{t("每周变化")}</span><strong className="rate-value">{rateText(stats.rate, t)}</strong><small>{t("对比最近两个 7 天")}</small></div>
        <div><span>{t("距离")} {number.format(profile.goalWeight)} kg</span><strong>{number.format(stats.remaining)} <small>kg</small></strong>
          <small>{stats.eta ? t`预计约 ${stats.eta}` : stats.latest && stats.remaining === 0 ? t("已达到目标体重") : t`目标日期 ${profile.goalDay}`}</small></div>
      </div>
      <WeightPlot rows={stats.sorted} today={today} days={days} large/>
      {stats.latest && <div className="chart-legend"><span>{t("实际体重")}</span><span>{t("7 日滚动平均")}</span></div>}
    </section>
    <div className="subpage-grid">
      <section className="card padded">
        <CardHead title={t("14 天趋势复盘")} icon="pulse"/>
        {!review ? <p className="muted">{t("首次录入实际体重后，开始计算第一个 14 天周期。")}</p> :
          <>
            {review.day ? <p>{t("上次评估")} {compactDay(review.day)} · {rateText(review.rate, t)}</p> :
              <p className="muted">{t("正在积累第一个周期的体重记录。")}</p>}
            {kcal !== 0 && <div className="review-suggestion">
              <p>{kcal < 0 ? t("连续两周降幅低于目标，可考虑每天少 125 kcal。") : t("连续两周降幅高于目标，可考虑每天多 125 kcal。")}</p>
              {canAdjust ? <Button variant="primary" onClick={() => setAdjust(true)}>{t("查看调整")}</Button> :
                <p className="fine">{t("当前宏量目标需要更多热量。可在设置页一起调整。")}</p>}
              <Button variant="quiet" onClick={() => handleReview(false)} disabled={busy}>{t("保留当前目标")}</Button>
            </div>}
            {review.day && !kcal && <p className="fine">{t("需要连续两周都有可比趋势，每 7 天至少 3 次，覆盖至少 4 个日历日。")}</p>}
            <p className="fine">{t("下次评估")} {review.next}</p>
          </>}
        <ErrorText>{error}</ErrorText>
      </section>
      <section className="card padded">
        <CardHead title={t("称重记录")} icon="scale"/>
        {rows.length ? [...rows].sort((a, b) => b.payload.day.localeCompare(a.payload.day)).slice(0, visible).map((row) =>
          <div className="history-row" key={row.id}>
            <span>{row.payload.day}</span><strong>{number.format(row.payload.kg)} kg</strong>
            <IconButton icon="edit" label={t`编辑 ${row.payload.day} 体重`} onClick={() => edit(row)}/>
            <IconButton icon="trash" label={t`删除 ${row.payload.day} 体重`} onClick={() => remove(row)}/>
          </div>) : <Empty icon="scale" title={t("还没有称重记录。")} action={<Button icon="plus" onClick={add}>{t("录入体重")}</Button>}/>}
        {rows.length > visible && <Button variant="quiet" onClick={() => setVisible(visible + 20)}>{t("显示更多")}</Button>}
      </section>
    </div>
    {adjust && <Modal title={t("确认热量调整")} close={() => setAdjust(false)} footer={
      <><Button onClick={() => setAdjust(false)}>{t("取消")}</Button>
        <Button variant="primary" onClick={() => handleReview(true)} disabled={busy || !canAdjust}>{t("确认新目标")}</Button></>
    }>
      <p className="fine">{t("蛋白质")} {number.format(profile.protein)} g · {t("脂肪")} {number.format(profile.fat)} g</p>
      {ACTIVITIES.map((activity) => {
        const current = dailyTarget(profile, activity);
        const adjusted = dailyTarget(adjustedProfile, activity);
        return <div className="history-row" key={activity}>
          <div>
            <span>{t(ACTIVITY_LABELS[activity])}</span>
            <div className="fine">{t("碳水")} {number.format(current.carbs)} → {number.format(adjusted.carbs)} g</div>
          </div>
          <span>{whole.format(current.kcal)} → <strong>{whole.format(adjusted.kcal)}</strong> kcal</span>
        </div>;
      })}
      <ErrorText>{error}</ErrorText>
    </Modal>}
  </div>;
}
