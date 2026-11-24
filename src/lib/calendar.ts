import { compactDay, dayIndex, monthTitle, shiftDay, weekStart } from "./dates.ts";
import type { Language } from "./locale.ts";
import { activityFor, dailyTarget, energyEstimate, recordsOf, type Activity, type Profile, type Row, type Workout, type WorkoutKind } from "./model.ts";
import { foodTotals } from "./nutrition.ts";

export const CALENDAR_VIEWS = ["week", "month", "quarter"] as const;
export type CalendarView = typeof CALENDAR_VIEWS[number];

// Advance from the first of a month so short months cannot skip a period.
export function shiftMonth(day: string, months: number) {
  const date = new Date(day.slice(0, 7) + "-01T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function calendarPeriod(day: string, view: CalendarView, language: Language = "zh") {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  if (view === "week") {
    const start = weekStart(day);
    const end = shiftDay(start, 6);
    const label = start.slice(0, 4) === end.slice(0, 4)
      ? `${year}${language === "zh" ? " 年" : ""} · ${compactDay(start)}–${compactDay(end)}`
      : `${start.slice(0, 4)}/${compactDay(start)}–${end.slice(0, 4)}/${compactDay(end)}`;
    return { start, end, label };
  }
  const quarter = Math.ceil(month / 3);
  const start = shiftMonth(day, view === "quarter" ? -((month - 1) % 3) : 0);
  const end = shiftDay(shiftMonth(start, view === "quarter" ? 3 : 1), -1);
  const label = language === "en"
    ? view === "quarter" ? `Q${quarter} ${year}` : `${monthTitle(start, language)} ${year}`
    : view === "quarter" ? `${year} 年第 ${quarter} 季度` : `${year} 年 ${month} 月`;
  return { start, end, label };
}

export function calendarDays(start: string, end: string) {
  return Array.from({ length: dayIndex(end) - dayIndex(start) + 1 }, (_, index) => shiftDay(start, index));
}

// 2024 Adult Compendium reference intensities. Treadmill assumes walking without a speed entry.
const WORKOUT_MET: Record<WorkoutKind, number> = {
  strength: 3.5,  // Multiple exercises at varied resistance (02054).
  basketball: 6, // General non-game play (15050).
  incline: 5.3,  // Moderate uphill walking (17034).
  treadmill: 3.8, // Level treadmill walking, 3.0–3.4 mph (17355).
  other: 4,      // Moderate cardio-resistance exercise (02143).
};

// These are starting estimates for a manually selected workout without a recorded duration.
const ASSUMED_MINUTES = { strength: 50, basketball: 60 };
type SelectableWorkout = keyof typeof ASSUMED_MINUTES;
const ACTIVITY_WORKOUTS: Record<Activity, SelectableWorkout[]> = {
  rest: [], strength: ["strength"], basketball: ["basketball"], both: ["strength", "basketball"],
};

// Start with a low-activity day and add only exercise energy above rest.
function estimateDayEnergy(profile: Profile, workouts: Workout[], selectedActivity?: Activity) {
  const baseline = energyEstimate({ ...profile, level: "low" })?.tdee ?? null;
  const selected = selectedActivity === undefined ? null : ACTIVITY_WORKOUTS[selectedActivity];
  const duration = new Map<WorkoutKind, number>();
  const untimed = new Map<WorkoutKind, number>();
  for (const { kind, minutes } of workouts) {
    if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) {
      untimed.set(kind, (untimed.get(kind) ?? 0) + 1);
      continue;
    }
    duration.set(kind, (duration.get(kind) ?? 0) + minutes);
  }

  const assumed: { kind: SelectableWorkout; minutes: number }[] = [];
  for (const kind of selected ?? []) {
    if (duration.has(kind)) continue;
    const minutes = ASSUMED_MINUTES[kind];
    duration.set(kind, minutes);
    const incomplete = untimed.get(kind);
    if (incomplete) untimed.set(kind, incomplete - 1);
    assumed.push({ kind, minutes });
  }

  const trainingDetails = Array.from(duration, ([kind, minutes]) => ({
    kind, minutes, kcal: (WORKOUT_MET[kind] - 1) * 3.5 * profile.weight * minutes / 200,
    assumed: assumed.some((entry) => entry.kind === kind),
  }));
  const training = Math.round(trainingDetails.reduce((total, { kcal }) => total + kcal, 0));
  const missingDuration = Array.from(untimed.values()).reduce((total, count) => total + count, 0);
  return { baseline, training, trainingDetails, missingDuration, assumed, fromSelection: assumed.length > 0,
    total: baseline === null ? null : baseline + training };
}

// Use the same daily budget as the dashboard and count only recorded days in period totals.
export function calendarStats(rows: Row[], profile: Profile, start: string, end: string, today: string) {
  const intake = new Map<string, number>();
  for (const { payload } of recordsOf(rows, "food")) {
    if (payload.day < start || payload.day > end || payload.day > today) continue;
    const total = foodTotals(payload)?.total;
    if (total) intake.set(payload.day, (intake.get(payload.day) ?? 0) + total.kcal);
  }
  const workouts = new Map<string, Workout[]>();
  for (const { payload } of recordsOf(rows, "workout")) {
    if (payload.day < start || payload.day > end) continue;
    const entries = workouts.get(payload.day) ?? [];
    entries.push(payload);
    workouts.set(payload.day, entries);
  }
  const manual = new Map(recordsOf(rows, "activity").map(({ payload }) => [payload.day, payload.activity]));
  const weights = recordsOf(rows, "weight").filter(({ sample }) => !sample)
    .map(({ payload }) => payload).sort((a, b) => a.day.localeCompare(b.day));
  let weightIndex = 0;
  let weight = profile.weight;
  const days = calendarDays(start, end).map((day) => {
    while (weightIndex < weights.length && weights[weightIndex].day <= day) {
      weight = weights[weightIndex].kg;
      weightIndex += 1;
    }
    const dayWorkouts = workouts.get(day) ?? [];
    const selection = manual.get(day);
    const activity = selection ?? activityFor(dayWorkouts);
    const target = dailyTarget(profile, activity).kcal;
    const kcal = intake.get(day) ?? null;
    // A selection can add planned activity today. Logged workouts always count.
    const energy = day <= today ? estimateDayEnergy({ ...profile, weight }, dayWorkouts, day === today ? selection : undefined) : null;
    const expenditure = energy?.total ?? null;
    const shortfall = expenditure === null || kcal === null ? null : expenditure - kcal;
    return { day, activity, kcal, target, energy, expenditure, shortfall, overTarget: kcal !== null && Math.round(kcal) > target };
  });
  const recorded = days.filter(({ kcal }) => kcal !== null);
  const consumed = recorded.reduce((total, day) => total + (day.kcal ?? 0), 0);
  const target = recorded.reduce((total, day) => total + day.target, 0);
  const expenditure = recorded.length && recorded.every((day) => day.expenditure !== null)
    ? recorded.reduce((total, day) => total + (day.expenditure ?? 0), 0) : null;
  return {
    days, recorded: recorded.length, elapsed: days.filter(({ day }) => day <= today).length,
    overTarget: recorded.filter((day) => day.overTarget).length,
    missingDuration: recorded.reduce((total, day) => total + (day.energy?.missingDuration ?? 0), 0),
    consumed, target, expenditure, shortfall: expenditure === null ? null : expenditure - consumed,
  };
}

export type CalendarDayStats = ReturnType<typeof calendarStats>["days"][number];
