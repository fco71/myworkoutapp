import { endOfISOWeek, format, startOfISOWeek } from "date-fns";
import { getDB, getWeeklyGoals } from "../db";
import type { WeeklyGoals } from "../types";

export type WeeklyCounts = Record<string, number>;

export async function getWeeklyCounts(now = new Date()) {
  const db = await getDB();
  const [sets, acts, goals] = await Promise.all([
    db.getAll("sets"),
    db.getAll("activities"),
    getWeeklyGoals(),
  ]);

  const from = startOfISOWeek(now).getTime();
  const to = endOfISOWeek(now).getTime();

  const counts: WeeklyCounts = { resistance: 0, cardio: 0, mobility: 0, other: 0 };

  for (const s of sets) if (s.ts >= from && s.ts <= to) counts["resistance"]++;
  for (const a of acts) if (a.ts >= from && a.ts <= to) counts[a.type] = (counts[a.type] || 0) + 1;

  return { counts, goals, rangeLabel: `${format(from, "LLL d")} – ${format(to, "LLL d")}` };
}

export function statusClasses(type: string, counts: WeeklyCounts, goals: WeeklyGoals) {
  const g = goals?.[type as keyof WeeklyGoals] ?? 0;
  const c = counts[type] ?? 0;
  if (g > 0 && c >= g) return "bg-green-600 text-white";
  if (g > 0 && c === g - 1) return "bg-amber-400 text-black";
  return "bg-neutral-200 text-neutral-900";
}