import { dayIndex, shiftDay, weekStart } from "./dates.ts";
import { MUSCLES, workoutMuscles, type Muscle, type Profile, type Workout } from "./model.ts";

export type WeighIn = { day: string; kg: number };
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

function windowStats(rows: WeighIn[], end: string) {
  const start = shiftDay(end, -6);
  const week = rows.filter(({ day }) => day >= start && day <= end);
  if (week.length === 0) return null;
  const days = week.map(({ day }) => dayIndex(day));
  return {
    kg: mean(week.map(({ kg }) => kg)),
    coverage: week.length,
    center: mean(days),
    enough: week.length >= 3 && Math.max(...days) - Math.min(...days) >= 3,
  };
}

function weeklyChange(earlier: ReturnType<typeof windowStats>, later: ReturnType<typeof windowStats>) {
  if (!earlier?.enough || !later?.enough) return null;
  return (earlier.kg - later.kg) * 7 / (later.center - earlier.center);
}

export function trend(rows: WeighIn[], today: string, profile: Profile) {
  const sorted = rows.filter(({ day }) => day <= today).sort((a, b) => a.day.localeCompare(b.day));
  const latest = sorted.at(-1);
  const recent = windowStats(sorted, today);
  const rate = weeklyChange(windowStats(sorted, shiftDay(today, -7)), recent);
  const current = latest?.kg ?? profile.weight;
  const remaining = Math.max(0, current - profile.goalWeight);
  let eta: string | null = null;
  if (latest && recent && rate !== null && rate >= 0.1 && remaining > 0 && today <= shiftDay(latest.day, 5)) {
    const days = Math.ceil(Math.max(0, recent.kg - profile.goalWeight) / rate * 7);
    if (days <= 365) eta = shiftDay(today, days);
  }
  return { sorted, latest, current, recent, rate, remaining, eta };
}

export function rollingWeights(rows: WeighIn[]) {
  return rows.map(({ day }) => ({ day, kg: windowStats(rows, day) }))
    .flatMap(({ day, kg }) => kg && kg.coverage >= 2 ? [{ day, kg: kg.kg }] : []);
}

export function trendReview(rows: WeighIn[], today: string, profile: Profile) {
  const sorted = rows.filter(({ day }) => day <= today).sort((a, b) => a.day.localeCompare(b.day));
  const first = sorted[0];
  if (!first) return null;
  const cycle = Math.floor((dayIndex(today) - dayIndex(first.day) + 1) / 14);
  if (cycle < 1) return { next: shiftDay(first.day, 13), day: null, rate: null, adjustment: 0 };
  const day = shiftDay(first.day, cycle * 14 - 1);
  const current = windowStats(sorted, day);
  const prior = windowStats(sorted, shiftDay(day, -7));
  const rate = weeklyChange(prior, current);
  const before = weeklyChange(windowStats(sorted, shiftDay(day, -14)), prior);
  let adjustment = 0;
  if (rate !== null && before !== null && day !== profile.handledReview) {
    if (rate < profile.paceMin - 0.1 && before < profile.paceMin - 0.1) adjustment = -125;
    if (rate > profile.paceMax + 0.1 && before > profile.paceMax + 0.1) adjustment = 125;
  }
  return { day, rate, next: shiftDay(day, 14), adjustment };
}

export function weeklyWorkouts(workouts: Workout[], today: string) {
  const start = weekStart(today);
  const end = shiftDay(start, 6);
  const week = workouts.filter((workout) => workout.day >= start && workout.day <= today);
  const strength = new Set(week.filter((workout) => workout.kind === "strength").map((workout) => workout.day));
  const basketball = new Set(week.filter((workout) => workout.kind === "basketball").map((workout) => workout.day));
  const muscles = Object.fromEntries(MUSCLES.map((muscle) => [muscle, new Set<string>()])) as Record<Muscle, Set<string>>;
  for (const workout of week) {
    if (workout.kind !== "strength") continue;
    for (const muscle of workoutMuscles(workout)) muscles[muscle].add(workout.day);
  }
  return { start, end, strength: strength.size, basketball: basketball.size, muscles };
}
