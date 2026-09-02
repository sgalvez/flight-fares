import type { Route } from "./domain.js";

const DAY_MS = 86_400_000;

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

export function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS);
}

export function horizonDates(today: Date, horizonDays: number): string[] {
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return Array.from({ length: horizonDays }, (_, index) => isoDate(addDays(base, index + 1)));
}

export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function daysRemainingInMonth(date: Date): number {
  const nextMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return Math.max(1, Math.ceil((nextMonth.getTime() - date.getTime()) / DAY_MS));
}

export function leadBucket(departureDate: string, capturedAt: string): "1-7" | "8-14" | "15-30" | "31-60" {
  const lead = daysBetween(isoDate(new Date(capturedAt)), departureDate);
  if (lead <= 7) return "1-7";
  if (lead <= 14) return "8-14";
  if (lead <= 30) return "15-30";
  return "31-60";
}

export function routeKey(route: Route): string {
  return `${route.origin}-${route.destination}`;
}

export function chooseDiscoveryDates(
  dates: string[],
  dailyBudget: number,
  now: Date
): string[] {
  if (dailyBudget <= 0) return [];
  const near = dates.slice(0, 14);
  const middle = dates.slice(14, 30);
  const far = dates.slice(30);
  const daySeed = Math.floor(now.getTime() / DAY_MS);
  const rotate = (values: string[], divisor: number) =>
    values.filter((_, index) => (index + daySeed) % divisor === 0);
  const prioritized = [...near, ...rotate(middle, 2), ...rotate(far, 4)];
  const remaining = dates.filter((date) => !prioritized.includes(date));
  return [...prioritized, ...remaining].slice(0, dailyBudget);
}

export function chooseRotatingDates(dates: string[], count: number, now: Date): string[] {
  if (dates.length === 0 || count <= 0) return [];
  const seed = Math.floor(now.getTime() / DAY_MS) % dates.length;
  return Array.from({ length: Math.min(count, dates.length) }, (_, index) => dates[(seed + index * 17) % dates.length]!)
    .filter((value, index, array) => array.indexOf(value) === index);
}
