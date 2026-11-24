import type { Language } from "./locale.ts";

// Use calendar dates in Los Angeles. Arithmetic uses UTC only for calendar offsets.
export const TZ = "America/Los_Angeles";
const dateKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const titleFormat = {
  zh: new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", month: "long", day: "numeric", weekday: "long" }),
  en: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", weekday: "short" }),
};
const englishMonth = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" });
const hoursFormat = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", hour: "numeric" });
const DAY = 86_400_000;

export function todayLA(now = new Date()): string {
  const parts = Object.fromEntries(dateKeyFormat.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function hourLA(now = new Date()): number {
  return Number(hoursFormat.format(now));
}

export function dayIndex(value: string): number {
  return Date.parse(`${value}T00:00:00Z`) / DAY;
}

export function isDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const index = dayIndex(value);
  return Number.isFinite(index) && new Date(index * DAY).toISOString().slice(0, 10) === value;
}

export function shiftDay(value: string, offset: number) {
  return new Date((dayIndex(value) + offset) * DAY).toISOString().slice(0, 10);
}

export function weekStart(value: string) {
  const weekday = new Date(dayIndex(value) * DAY).getUTCDay();
  return shiftDay(value, -((weekday + 6) % 7));
}

export function dateTitle(value: string, language: Language = "zh") {
  return titleFormat[language].format(new Date(dayIndex(value) * DAY));
}

export function monthTitle(value: string, language: Language) {
  return language === "en" ? englishMonth.format(new Date(dayIndex(value) * DAY)) : `${Number(value.slice(5, 7))} 月`;
}

export function compactDay(value: string) {
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
}
