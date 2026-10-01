import { config } from "./config.js";
import { TEXTS } from "./data/texts.js";

const tz = config.timezone;

function partsInTz(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

/** Перевод "настенного" времени в часовом поясе мастера в UTC Date. */
export function zonedToUtc(dateKey: string, hour: number, minute = 0): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const p = partsInTz(new Date(guess));
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - guess;
  return new Date(guess - offset);
}

/** Ключи дат YYYY-MM-DD на ближайшие N дней (начиная с сегодня) в часовом поясе мастера. */
export function upcomingDateKeys(days: number): string[] {
  const now = partsInTz(new Date());
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(Date.UTC(now.y, now.m - 1, now.d + i));
    keys.push(dt.toISOString().slice(0, 10));
  }
  return keys;
}

export function formatDateKey(dateKey: string): string {
  return zonedToUtc(dateKey, 12).toLocaleDateString("ru-RU", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "long",
  });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString("ru-RU", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Короткая дата и время для кнопок: "вт 30.09 · 10:00" */
export function formatShortDateTime(date: Date): string {
  const weekday = date.toLocaleDateString("ru-RU", { timeZone: tz, weekday: "short" });
  const day = date.toLocaleDateString("ru-RU", { timeZone: tz, day: "2-digit", month: "2-digit" });
  return `${weekday} ${day} · ${formatTime(date)}`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
}

/** "2026-10" → "Октябрь 2026" */
export function formatMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${TEXTS.calendar.months[m - 1]} ${y}`;
}

/** Все даты месяца YYYY-MM-DD. */
export function monthDateKeys(monthKey: string): string[] {
  const [y, m] = monthKey.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, "0")}`);
}

/** День недели даты, 0 = понедельник. */
export function weekdayMon(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Дата YYYY-MM-DD момента времени в часовом поясе мастера. */
export function dateKeyOf(date: Date): string {
  const p = partsInTz(date);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
