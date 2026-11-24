"use client";

import { useLanguage } from "./language";
import { useMemo, useState } from "react";
import { calendarDays } from "../lib/calendar";
import { compactDay, shiftDay } from "../lib/dates";
import { MUSCLES, MUSCLE_LABELS, WORKOUT_KINDS, WORKOUT_LABELS, makeId, workoutMuscles, type Exercise, type LogRow,
  type Muscle, type Workout, type WorkoutKind, type WorkoutPreset } from "../lib/model";
import { normalize, number } from "../lib/nutrition";
import { weeklyWorkouts } from "../lib/trends";
import { WorkoutList } from "./dashboard";
import { Button, CardHead, Empty, ErrorText, Field, Icon, IconButton, Modal } from "./ui";

const common: Record<Muscle, string[]> = {
  chest: ["卧推", "上斜哑铃卧推", "夹胸"],
  back: ["高位下拉", "坐姿划船", "引体向上"],
  shoulders: ["肩推", "绳索侧平举", "Y 字上举", "反向飞鸟"],
  legs: ["深蹲", "倒蹬机", "腿弯举", "罗马尼亚硬拉"],
  arms: ["弯举", "三头下压"],
  core: ["卷腹", "悬垂举腿"],
};
type ExerciseDraft = { key: string; name: string; muscle: Muscle; weight: string; unit: "lb" | "kg"; sets: string; reps: string };
const emptyExercise = (muscle: Muscle = "chest"): ExerciseDraft => ({
  key: makeId(), name: "", muscle, weight: "", unit: "lb", sets: "3", reps: "10",
});
const exerciseDraft = (entry: Exercise): ExerciseDraft => ({
  ...entry, key: makeId(), weight: String(entry.weight), sets: String(entry.sets), reps: String(entry.reps),
});

export function WorkoutModal({ today, date, initial, presets, save, close }: {
  today: string; date?: string; initial?: LogRow<"workout">; presets: LogRow<"workout_preset">[];
  save: (workout: Workout, preset?: WorkoutPreset) => Promise<void>; close: () => void;
}) {
  const { t } = useLanguage();
  const existing = initial?.payload;
  const [kind, setKind] = useState<WorkoutKind>(existing?.kind ?? "strength");
  const [day, setDay] = useState(existing?.day ?? date ?? today);
  const [minute, setMinute] = useState(existing?.minutes ? String(existing.minutes) : "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [moves, setMoves] = useState(() => existing?.exercises.map(exerciseDraft) ?? []);
  const [muscles, setMuscles] = useState<Muscle[]>(existing?.muscles ?? []);
  const [template, setTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const adjust = (key: string, change: Partial<ExerciseDraft>) => setMoves((before) =>
    before.map((move) => move.key === key ? { ...move, ...change } : move));

  function usePreset(preset: WorkoutPreset) {
    setKind(preset.kind);
    setMinute(preset.minutes ? String(preset.minutes) : "");
    setNote(preset.note);
    setMoves(preset.exercises.map(exerciseDraft));
    setMuscles(preset.muscles ?? []);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!day || day > today) { setError("请选择今天或过去的日期。"); return; }
    if (kind === "strength" && !moves.length && !muscles.length) { setError("请选择肌群或添加一个动作。"); return; }
    const exercises: Exercise[] = kind === "strength" ? moves.map((move) => ({
      name: common[move.muscle].find((name) => normalize(t(name)) === normalize(move.name)) ?? move.name.trim(),
      muscle: move.muscle, weight: Number(move.weight),
      unit: move.unit, sets: Number(move.sets), reps: Number(move.reps),
    })) : [];
    if (exercises.some((move) => !move.name || !move.sets || !move.reps)) { setError("请填写动作、组数和次数。"); return; }
    if (template && !templateName.trim()) { setError("给模板填一个名称。"); return; }
    const details = { kind, exercises, minutes: minute ? Number(minute) : null, note: note.trim(),
      ...(kind === "strength" && muscles.length ? { muscles } : {}) };
    setBusy(true);
    try { await save({ ...details, day, time: existing?.time ?? Date.now() }, template ? { ...details, name: templateName.trim() } : undefined); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <Modal title={initial ? t("编辑训练") : t("记录训练")} close={close} wide footer={
    <Button type="submit" form="workout-form" variant="primary" icon="check" disabled={busy}>{busy ? t("正在保存…") : t("保存训练")}</Button>
  }>
    <form id="workout-form" className="form-stack" onSubmit={submit}>
      {presets.length > 0 && !initial && <Field label={t("套用训练模板")}><select defaultValue="" onChange={(e) => {
        const preset = presets.find(({ id }) => id === e.target.value); if (preset) usePreset(preset.payload);
      }}><option value="">{t("选择模板…")}</option>{presets.map(({ id, payload }) => <option key={id} value={id}>{t(payload.name)}</option>)}</select></Field>}
      <div className="form-grid">
        <Field label={t("日期")}><input type="date" required max={today} value={day} onChange={(e) => setDay(e.target.value)}/></Field>
        <Field label={t("时长（分钟，选填）")}><input type="number" inputMode="numeric" min="1" max="600" value={minute}
          onChange={(e) => setMinute(e.target.value)} placeholder="45" aria-describedby="workout-duration-help"/></Field>
      </div>
      <p className="fine" id="workout-duration-help">{t("消耗按训练时长估算。时长请扣除长时间等场或休息。")}</p>
      <div className="segments wrap" role="group" aria-label={t("训练类型")}>{WORKOUT_KINDS.map((value) =>
        <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>{t(WORKOUT_LABELS[value])}</button>)}</div>
      {kind === "strength" && <>
        {(!moves.length || muscles.length > 0) && <div className="field">
          <span>{t("训练肌群")}</span>
          <div className="segments wrap" role="group" aria-label={t("训练肌群")}>
            {MUSCLES.map((muscle) => <button key={muscle} type="button" aria-pressed={muscles.includes(muscle)}
              onClick={() => setMuscles((before) => before.includes(muscle) ? before.filter((value) => value !== muscle) : [...before, muscle])}>
              {t(MUSCLE_LABELS[muscle])}
            </button>)}
          </div>
        </div>}
        {moves.map((move) => <div className="exercise-editor" key={move.key}>
          <div className="exercise-label">
            <Field label={t("动作")}><input maxLength={70} list={`exercise-${move.key}`} required value={t(move.name)}
              placeholder={t(common[move.muscle][0])} onChange={(e) => adjust(move.key, { name: e.target.value })}/>
              <datalist id={`exercise-${move.key}`}>{common[move.muscle].map((name) => <option key={name} value={t(name)}/>)}</datalist>
            </Field>
            <Field label={t("肌群")}><select value={move.muscle} onChange={(e) => adjust(move.key, { muscle: e.target.value as Muscle })}>
              {MUSCLES.map((value) => <option key={value} value={value}>{t(MUSCLE_LABELS[value])}</option>)}
            </select></Field>
            <IconButton icon="trash" label={t("移除动作")} onClick={() => setMoves((list) => list.filter(({ key }) => key !== move.key))}/>
          </div>
          <div className="form-grid four">
            <Field label={t("重量")}><input type="number" inputMode="decimal" min="0" max="2500" step="any" placeholder="0"
              value={move.weight} onChange={(e) => adjust(move.key, { weight: e.target.value })}/></Field>
            <Field label={t("单位")}><select value={move.unit} onChange={(e) => adjust(move.key, { unit: e.target.value as Exercise["unit"] })}>
              <option value="lb">lb</option><option value="kg">kg</option>
            </select></Field>
            <Field label={t("组数")}><input type="number" inputMode="numeric" min="1" max="100" required
              value={move.sets} onChange={(e) => adjust(move.key, { sets: e.target.value })}/></Field>
            <Field label={t("每组次数")}><input type="number" inputMode="numeric" min="1" max="300" required
              value={move.reps} onChange={(e) => adjust(move.key, { reps: e.target.value })}/></Field>
          </div>
        </div>)}
        <Button icon="plus" disabled={moves.length >= 30} onClick={() => setMoves((before) => [...before, emptyExercise(before.at(-1)?.muscle ?? muscles[0])])}>{t("加一个动作")}</Button>
      </>}
      <Field label={t("训练备注（选填）")}><textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder={t("例如坡度 10%，或今天最后一组的感觉")}/></Field>
      <label className="checkbox"><input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)}/> {t("保存为训练模板")}</label>
      {template && <Field label={t("模板名称")}><input value={templateName} required maxLength={65} placeholder={t("背部训练")}
        onChange={(e) => setTemplateName(e.target.value)}/></Field>}
      <ErrorText>{error}</ErrorText>
    </form>
  </Modal>;
}

// Fit training types in a compact date cell and show full details once selected.
function trainingTag(workout: Workout) {
  if (workout.kind === "basketball") return "篮球";
  if (workout.kind !== "strength") return "有氧";
  const muscles = workoutMuscles(workout);
  return muscles.length === 1 ? MUSCLE_LABELS[muscles[0]] : "力量";
}

export function TrainingPage({ today, day, selectDay, rows, presets, edit, remove, deletePreset, add }: {
  today: string; day: string; selectDay: (day: string) => void; rows: LogRow<"workout">[]; presets: LogRow<"workout_preset">[];
  edit: (row: LogRow<"workout">) => void; remove: (row: LogRow<"workout">) => void;
  deletePreset: (row: LogRow<"workout_preset">) => void; add: (day: string) => void;
}) {
  const { language, t } = useLanguage();
  const [selected, setSelected] = useState("");
  const ordered = useMemo(() => [...rows].sort((a, b) => b.payload.day.localeCompare(a.payload.day) || b.payload.time - a.payload.time), [rows]);
  const recentStart = shiftDay(today, -6);
  const yesterday = shiftDay(today, -1);
  const dailyRows = ordered.filter(({ payload }) => payload.day === day);
  const recent = new Map<string, Set<string>>();
  for (const { payload } of ordered) {
    if (payload.day < recentStart || payload.day > today) continue;
    const tags = recent.get(payload.day) ?? new Set<string>();
    tags.add(trainingTag(payload));
    recent.set(payload.day, tags);
  }
  const dateLabel = (date: string) => date === today ? t("今天") : date === yesterday ? t("昨天") : compactDay(date);
  const dateSeparator = language === "en" ? ", " : "，";
  const stats = weeklyWorkouts(rows.map(({ payload }) => payload), today);
  const choices = [...new Map(ordered.flatMap(({ payload }) => payload.exercises.map(({ name }) => [normalize(name), name]))).entries()];
  const history = selected ? ordered.flatMap(({ id, payload }) => payload.exercises
    .filter(({ name }) => normalize(name) === selected)
    .map((move, index) => ({ id: id + index, day: payload.day, move }))).slice(0, 60) : [];

  return <div className="subpage-grid">
    <div className="dashboard-column">
      <section className="card padded">
        <CardHead title={t("最近 7 天")} icon="calendar"/>
        <div className="calendar-grid training-dates" role="group" aria-label={t("最近 7 天训练")}>
          {calendarDays(recentStart, today).map((date) => {
            const tags = [...(recent.get(date) ?? [])];
            const shown = tags.length > 2 ? [tags[0], `+${tags.length - 1}`] : tags;
            return <button key={date} type="button" className={`calendar-day${tags.length ? " recorded" : ""}`}
              aria-pressed={date === day} aria-current={date === today ? "date" : undefined}
              aria-label={[dateLabel(date), date, tags.length ? tags.map((tag) => t(tag)).join(language === "en" ? ", " : "、") : t("未记训练")].join(dateSeparator)}
              onClick={() => selectDay(date)}>
              <strong>{date === yesterday && language === "en" ? "Yday" : dateLabel(date)}</strong>
              {shown.length ? shown.map((tag) => <span key={tag}>{tag === "篮球" && language === "en" ? "Hoops" : t(tag)}</span>) : <span>—</span>}
            </button>;
          })}
        </div>
        <section className="training-day-records" aria-labelledby="training-day-heading">
          <h3 id="training-day-heading">{t`${dateLabel(day)}的训练`}</h3>
          {dailyRows.length ? <WorkoutList rows={dailyRows} onEdit={edit} onDelete={remove} showDetails/> :
            <Empty icon="lift" title={t("当天没有训练记录。")} action={<Button icon="plus" onClick={() => add(day)}>{t("添加当天训练")}</Button>}/>}
        </section>
      </section>
      <section className="card padded">
        <CardHead title={t("本周训练")} icon="lift"><span className="fine">{compactDay(stats.start)} – {compactDay(stats.end)}</span></CardHead>
        <div className="training-stats">
          <div><span>{t("力量训练")}</span><strong>{stats.strength} <small>{t("/ 4–5 天")}</small></strong><progress aria-label={t("本周力量天数")} max={5} value={Math.min(5, stats.strength)}/></div>
          <div><span>{t("篮球")}</span><strong>{stats.basketball} <small>{t("/ 2 天")}</small></strong><progress aria-label={t("本周篮球天数")} max={2} value={Math.min(2, stats.basketball)}/></div>
          <div><span>{t("腿部")}</span><strong className="leg-status">{stats.muscles.legs.size ? t("已训练") : t("待训练")}</strong><small>{t("每周至少 1 天")}</small></div>
        </div>
        <details className="training-muscles">
          <summary>{t("各肌群训练天数")}</summary>
          <div className="muscle-grid">{MUSCLES.map((muscle) => <div key={muscle}>
            <span>{t(MUSCLE_LABELS[muscle])}</span><strong>{stats.muscles[muscle].size} <small>{t("天")}</small></strong>
          </div>)}</div>
        </details>
      </section>
    </div>
    <div className="dashboard-column">
      <section className="card padded">
        <CardHead title={t("动作历史")} icon="chart"/>
        {choices.length ? <>
          <Field label={t("动作")}><select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">{t("选择动作查看历史")}</option>{choices.map(([value, name]) => <option key={value} value={value}>{t(name)}</option>)}
          </select></Field>
          {history.map(({ id, day, move }) => <div className="history-row" key={id}>
            <span>{compactDay(day)}</span><strong>{number.format(move.weight)} {move.unit}</strong><span>{t`${move.sets} 组 × ${move.reps} 次`}</span>
          </div>)}
        </> : <p className="muted">{t("录入力量训练后，可以按动作查看重量与次数。")}</p>}
      </section>
      <section className="card padded">
        <CardHead title={t("训练模板")} icon="star"/>
        {presets.length ? presets.map((preset) => <div className="history-row" key={preset.id}>
          <span>{t(preset.payload.name)}</span><IconButton icon="trash" label={t`删除模板 ${t(preset.payload.name)}`} onClick={() => deletePreset(preset)}/>
        </div>) : <p className="muted">{t("记录训练时可保存常做动作，之后一键套用。")}</p>}
      </section>
    </div>
  </div>;
}
