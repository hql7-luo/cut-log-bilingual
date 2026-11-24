import { useLanguage } from "./language";
import { ACTIVITIES, ACTIVITY_LABELS, dailyTarget, MEALS, MEAL_LABELS, MUSCLE_LABELS, WORKOUT_LABELS, workoutMuscles,
  type Activity, type LogRow, type Meal, type Profile, type Workout } from "../lib/model";
import { foodTotals, MACROS, NUTRIENT_LABEL, number, portionText, sourceLabel, sum, whole } from "../lib/nutrition";
import type { CalendarDayStats } from "../lib/calendar";
import { compactDay } from "../lib/dates";
import { translate, type Language } from "../lib/locale";
import { trend } from "../lib/trends";
import { Button, CardHead, Empty, Icon, IconButton, type IconName } from "./ui";
import { WeightPlot } from "./weight-plot";

const mealIcons: Record<Meal, IconName> = { breakfast: "coffee", lunch: "bowl", dinner: "moon", snack: "snack" };
const activityIcons: Record<Activity, IconName> = { rest: "moon", strength: "lift", basketball: "ball", both: "bolt" };

export function FoodList({ rows, onEdit, onDelete, onCopy, mealHeading: MealHeading = "h3" }: {
  rows: LogRow<"food">[]; onEdit?: (entry: LogRow<"food">) => void;
  onDelete?: (entry: LogRow<"food">) => void; onCopy?: (meal: Meal, items: LogRow<"food">[]) => void;
  mealHeading?: "h3" | "h4";
}) {
  const { language, t } = useLanguage();
  return <div className="meal-groups">{MEALS.map((meal) => {
    const items = rows.filter((row) => row.payload.meal === meal).sort((a, b) => a.payload.time - b.payload.time);
    if (!items.length) return null;
    const total = sum(items.flatMap(({ payload }) => foodTotals(payload)?.total ?? []));
    return <section className="meal-group" key={meal}>
      <div className="meal-heading">
        <span className={`tile-icon meal-${meal}`}><Icon name={mealIcons[meal]} size={18}/></span>
        <MealHeading>{t(MEAL_LABELS[meal])}</MealHeading>
        <span className="meal-kcal">{whole.format(total.kcal)} <small>kcal</small></span>
        {onCopy && <IconButton icon="copy" label={t`复制${t(MEAL_LABELS[meal])}到今天`} onClick={() => onCopy(meal, items)}/>}
      </div>
      {items.map((row) => {
        const entry = row.payload;
        const total = foodTotals(entry);
        const name = t(entry.name);
        const description = <><strong>{name}</strong>
          <span>{portionText(entry, language)}{entry.estimatedPortion || entry.spec?.source === "estimate" ? ` ${t("· 估算")}` : ""}</span></>;
        return <div className="log-line" key={row.id}>
          {onEdit ? <button type="button" className="log-name" onClick={() => onEdit(row)} aria-label={t`编辑 ${name}`}>
            {description}
          </button> : <div className="log-name">{description}</div>}
          <span className="line-kcal" title={`${t(sourceLabel(entry))}${total?.bounds ? ` · ${whole.format(total.bounds.low.kcal)}–${whole.format(total.bounds.high.kcal)} kcal` : ""}`}>
            {total ? whole.format(total.total.kcal) : "—"}
          </span>
          {onDelete && <IconButton icon="trash" label={t`删除 ${name}`} onClick={() => onDelete(row)}/>}
        </div>;
      })}
    </section>;
  })}</div>;
}

function workoutTitle(workout: Workout, language: Language) {
  const label = translate(language, WORKOUT_LABELS[workout.kind]);
  const groups = workoutMuscles(workout).map((muscle) => translate(language, MUSCLE_LABELS[muscle]));
  return workout.kind === "strength" && groups.length ? `${groups.join(" / ")} · ${label}` : label;
}

export function WorkoutList({ rows, onEdit, onDelete, showDetails = false }: {
  rows: LogRow<"workout">[]; onEdit?: (entry: LogRow<"workout">) => void;
  onDelete?: (entry: LogRow<"workout">) => void; showDetails?: boolean;
}) {
  const { language, t } = useLanguage();
  return <div className="workout-list">{rows.map((row) => {
    const workout = row.payload;
    const title = workoutTitle(workout, language);
    const summary = workout.exercises.length ? t`${workout.exercises.length} 个动作` : workout.note;
    const subtitle = [workout.minutes ? t`${workout.minutes} 分钟` : "",
      showDetails ? "" : summary].filter(Boolean).join(" · ");
    const description = <><strong>{title}</strong>{(subtitle || !showDetails) && <span>{subtitle || t("已记录")}</span>}</>;
    return <div className="workout-entry" key={row.id}>
      <div className="workout-line">
        <span className="tile-icon ink-lime"><Icon name={workout.kind === "strength" ? "lift" : workout.kind === "basketball" ? "ball" : "pulse"} size={18}/></span>
        {onEdit ? <button type="button" className="log-name" onClick={() => onEdit(row)} aria-label={t`编辑 ${title}`}>
          {description}
        </button> : <div className="log-name">{description}</div>}
        {onDelete && <IconButton icon="trash" label={t`删除 ${title}`} onClick={() => onDelete(row)}/>}
      </div>
      {showDetails && workout.exercises.length > 0 && <ul className="workout-exercises">
        {workout.exercises.map((exercise, index) => <li key={`${exercise.name}-${index}`}>
          <strong>{t(exercise.name)}</strong>
          <span>{exercise.weight > 0 && `${number.format(exercise.weight)} ${exercise.unit} · `}
            {t`${exercise.sets} 组 × ${exercise.reps} 次`}</span>
        </li>)}
      </ul>}
      {showDetails && workout.note && <p className="workout-note">{workout.note}</p>}
    </div>;
  })}</div>;
}

// Explain the same training assumptions on the overview and the calendar.
export function TrainingEstimateNotes({ energy, target, expanded = false }: {
  energy: CalendarDayStats["energy"]; target: number; expanded?: boolean;
}) {
  const { language, t } = useLanguage();
  if (!energy) return null;
  const balanceAtTarget = energy.total === null ? null : energy.total - target;
  const assumed = energy.assumed.map(({ kind, minutes }) => t`${t(ACTIVITY_LABELS[kind])} ${minutes} 分钟`)
    .join(language === "en" ? ", " : "、");
  return <>
    {(energy.baseline !== null || energy.trainingDetails.length > 0) && <details className="energy-breakdown" open={expanded || undefined}>
      <summary>{t("消耗明细")}</summary>
      <dl>
        {energy.baseline !== null && <div><dt>{t("日常消耗")}</dt><dd>{whole.format(energy.baseline)} kcal</dd></div>}
        {energy.trainingDetails.map(({ kind, minutes, kcal, assumed }) => <div key={kind}>
          <dt>{t(WORKOUT_LABELS[kind])} · {assumed && <>{t("暂按")} </>}{t`${minutes} 分钟`}</dt>
          <dd>+{whole.format(kcal)} kcal</dd>
        </div>)}
      </dl>
      {balanceAtTarget !== null && <p className="fine">
        {t`若吃到日目标 ${whole.format(target)} kcal，${t(balanceAtTarget < 0 ? "估算盈余" : "估算缺口")} ${whole.format(Math.abs(balanceAtTarget))} kcal。`}
      </p>}
    </details>}
    {assumed && <p className="fine">{t`暂无时长，暂按${assumed}估算。`}</p>}
    {energy.missingDuration > 0 && <p className="fine">{t`${energy.missingDuration} 项训练补填时长后会计入消耗。`}</p>}
  </>;
}

function Budget({ profile, day, rows }: { profile: Profile; day: CalendarDayStats; rows: LogRow<"food">[] }) {
  const { t } = useLanguage();
  const target = dailyTarget(profile, day.activity);
  const items = rows.flatMap(({ payload }) => foodTotals(payload) ?? []);
  const consumed = sum(items.map(({ total }) => total));
  const left = target.kcal - consumed.kcal;
  const estimated = rows.some(({ payload }) => payload.spec?.source === "estimate" || payload.estimatedPortion);
  const balanceLabel = t((day.shortfall ?? 0) < 0 ? "今日估算盈余" : "今日估算缺口");
  const energy = day.energy;
  return <section className="card budget-card" aria-label={t("今日营养")} data-over={left < 0}>
    <CardHead title={t("今日营养")}>{estimated && <span className="fine">{t("含估算")}</span>}</CardHead>
    <dl className="energy-summary">
      <div className="energy-primary energy-budget">
        <dt>{left < 0 ? t("超出目标") : t("剩余热量")}</dt>
        <dd><strong aria-label={left < 0 ? t("超出热量") : t("剩余热量")}>{whole.format(Math.abs(left))}</strong><small>kcal</small></dd>
      </div>
      <div className="energy-primary energy-balance">
        <dt>{balanceLabel}</dt>
        <dd aria-label={balanceLabel}><strong>{day.shortfall === null ? "—" : whole.format(Math.abs(day.shortfall))}</strong>
          {day.shortfall !== null && <> <small>kcal</small></>}</dd>
        {day.shortfall !== null && <dd className="fine">{t("按已记录摄入估算")}</dd>}
      </div>
    </dl>
    <dl className="energy-measures">
      <div><dt>{t("已摄入")}</dt><dd aria-label={t("已摄入热量")}>{whole.format(consumed.kcal)}</dd></div>
      <div><dt>{t("日目标")}</dt><dd aria-label={t("热量目标")}>{whole.format(target.kcal)}</dd></div>
      <div><dt>{t("今日估算消耗")}</dt><dd aria-label={t("今日估算消耗")}>{day.expenditure === null ? "—" : <>{whole.format(day.expenditure)} <small>kcal</small></>}</dd></div>
    </dl>
    <progress className="energy-progress" max={target.kcal || 1} value={Math.min(target.kcal || 1, consumed.kcal)}
      aria-label={t("今日热量进度")}/>
    <div className="energy-notes">
      {day.expenditure === null ? <a className="text-link" href="#settings">{t("填写年龄后查看全天消耗")}</a> :
        day.kcal === null && <p className="fine">{t("记录饮食后显示缺口。")}</p>}
      <TrainingEstimateNotes energy={energy} target={target.kcal}/>
    </div>
    <div className="macros">{MACROS.map((macro) => {
      const delta = target[macro] - consumed[macro];
      return <div className={`macro ${macro}`} key={macro}>
        <div className="macro-title"><span/>{t(NUTRIENT_LABEL[macro])}</div>
        <p><strong>{number.format(consumed[macro])}</strong><span> / {number.format(target[macro])} g</span></p>
        <progress max={target[macro] || 1} value={Math.min(target[macro] || 1, consumed[macro])}
          aria-label={t`今日${t(NUTRIENT_LABEL[macro])}进度`}/>
        <small>{delta < -0.05 ? t("超出") : t("剩余")} {number.format(Math.abs(delta))} g</small>
      </div>;
    })}</div>
  </section>;
}

export function Dashboard({ today, profile, dayStats, manualActivity, foods, workouts, weights, onActivity, onFood,
  onWeight, onFoodEdit, onFoodDelete, onWorkoutEdit, onWorkoutDelete }: {
  today: string; profile: Profile; dayStats: CalendarDayStats; manualActivity: boolean;
  foods: LogRow<"food">[]; workouts: LogRow<"workout">[]; weights: LogRow<"weight">[];
  onActivity: (activity: Activity | null) => void; onFood: () => void; onWeight: () => void;
  onFoodEdit: (row: LogRow<"food">) => void; onFoodDelete: (row: LogRow<"food">) => void;
  onWorkoutEdit: (row: LogRow<"workout">) => void; onWorkoutDelete: (row: LogRow<"workout">) => void;
}) {
  const { t } = useLanguage();
  const stats = trend(weights.map(({ payload }) => payload), today, profile);
  const dailyFoods = foods.filter(({ payload }) => payload.day === today);
  const dailyWorkouts = workouts.filter(({ payload }) => payload.day === today).sort((a, b) => b.payload.time - a.payload.time);

  return <div className="dashboard-grid">
    <div className="dashboard-column">
      <Budget profile={profile} day={dayStats} rows={dailyFoods}/>
      <section className="card meals-card">
        <CardHead title={t("今日饮食")} icon="food"><a className="text-link" href="#food">{t("饮食历史")}</a></CardHead>
        {dailyFoods.length ? <FoodList rows={dailyFoods} onEdit={onFoodEdit} onDelete={onFoodDelete}/> :
          <Empty icon="bowl" title={t("今天还没有饮食记录。")} action={<Button onClick={onFood} icon="plus">{t("添加食物")}</Button>}/>}
      </section>
    </div>
    <div className="dashboard-column">
      <section className="card activity-card">
        <CardHead title={t("今天的活动")} icon="pulse"/>
        <div className="activity-grid">{ACTIVITIES.map((value) => <button key={value} type="button" className="activity-option"
          aria-pressed={value === dayStats.activity} onClick={() => onActivity(value)}>
          <Icon name={activityIcons[value]} size={19}/><span>{t(ACTIVITY_LABELS[value])}</span>
          <small>{whole.format(profile.calories[value])} kcal</small>
        </button>)}</div>
        <p className="activity-note">{t("活动选择影响摄入目标和预估，已记训练始终计入消耗。")}</p>
        {manualActivity && <button type="button" className="text-link" onClick={() => onActivity(null)}>{t("改为跟随训练记录")}</button>}
      </section>
      <section className="card weight-card">
        <CardHead title={t("体重趋势")} icon="scale"><button type="button" className="text-link" onClick={onWeight}>{t("记录体重")}</button></CardHead>
        <div className="weight-highlight">
          <div><strong>{number.format(stats.current)}</strong> <span>kg</span></div>
          <span className="weight-caption">{stats.latest ? t`${compactDay(stats.latest.day)} 实测` : t("设置体重")}</span>
        </div>
        <WeightPlot rows={stats.sorted} today={today} days={30}/>
        <div className="weight-card-footer">
          <span>{stats.recent ? t`7 日均重 ${number.format(stats.recent.kg)} kg` : t`目标 ${number.format(profile.goalWeight)} kg`}</span>
          <a className="text-link" href="#progress">{t("查看进度")}</a>
        </div>
      </section>
      <section className="card today-workouts">
        <CardHead title={t("今日训练")} icon="lift"><a className="text-link" href="#training">{t("训练记录")}</a></CardHead>
        {dailyWorkouts.length ? <WorkoutList rows={dailyWorkouts} onEdit={onWorkoutEdit} onDelete={onWorkoutDelete}/> :
          <p className="muted inner-text">{t("今天还没有训练记录。")}</p>}
      </section>
    </div>
  </div>;
}
