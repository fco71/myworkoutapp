import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { PersistedState, WeeklyPlan } from "@/types";
import { cn, getMonday, toISO } from "@/lib/workout-utils";

// Read-only long-term view: aggregates every stored week into month / year summaries.

type DayRecord = { dateISO: string; types: string[] };
type Mode = "month" | "year";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

// Single-hue sequential scale (indigo, light -> dark) for "how much activity".
const HEAT = ["bg-slate-100", "bg-indigo-200", "bg-indigo-300", "bg-indigo-500", "bg-indigo-700"];

function heatClass(count: number, max: number) {
  if (count <= 0) return HEAT[0];
  if (max <= 1) return HEAT[3];
  const step = Math.ceil((count / max) * 4);
  return HEAT[Math.min(4, Math.max(1, step))];
}

function isISODate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseISO(dateISO: string) {
  return new Date(`${dateISO}T00:00:00`);
}

function checkedTypes(day: WeeklyPlan["days"][number]) {
  return Object.keys(day.types || {})
    .map((t) => String(t).trim())
    .filter((t) => t && day.types[t]);
}

function collectDays(weeks: WeeklyPlan[]) {
  const byDate = new Map<string, DayRecord>();
  weeks.forEach((week) => {
    (week.days || []).forEach((day) => {
      if (!day?.dateISO || !isISODate(day.dateISO)) return;
      byDate.set(day.dateISO, { dateISO: day.dateISO, types: checkedTypes(day) });
    });
  });
  return byDate;
}

function pctChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function Delta({ current, previous, label }: { current: number; previous: number; label: string }) {
  const change = pctChange(current, previous);
  const text = change === null ? "new" : `${change > 0 ? "+" : ""}${change}%`;
  return (
    <span className={cn("text-xs", change === null || change > 0 ? "text-emerald-700" : change < 0 ? "text-rose-700" : "text-slate-500")}>
      {text} vs {label} ({previous})
    </span>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub ? <div className="mt-1">{sub}</div> : null}
    </div>
  );
}

function TypeBars({ totals, previous, compareLabel }: { totals: Map<string, number>; previous: Map<string, number>; compareLabel: string }) {
  const rows = Array.from(totals.entries()).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  if (rows.length === 0) return <p className="text-sm text-slate-500">Nothing logged in this period.</p>;
  return (
    <div className="space-y-2">
      {rows.map(([type, n]) => (
        <div key={type} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-sm" title={`${type}: ${n} (${compareLabel}: ${previous.get(type) || 0})`}>
          <span className="truncate text-slate-700">{type}</span>
          <div className="h-3 rounded-r bg-slate-100">
            <div className="h-3 rounded-r bg-indigo-500" style={{ width: `${(n / max) * 100}%` }} />
          </div>
          <span className="w-16 text-right tabular-nums text-slate-900">
            {n}
            <span className="ml-1 text-xs text-slate-400">/{previous.get(type) || 0}</span>
          </span>
        </div>
      ))}
      <p className="pt-1 text-xs text-slate-400">Count this period / {compareLabel}</p>
    </div>
  );
}

function tally(days: DayRecord[]) {
  const totals = new Map<string, number>();
  let sessions = 0;
  let activeDays = 0;
  days.forEach((d) => {
    if (d.types.length > 0) activeDays += 1;
    sessions += d.types.length;
    d.types.forEach((t) => totals.set(t, (totals.get(t) || 0) + 1));
  });
  return { totals, sessions, activeDays };
}

function daysInRange(byDate: Map<string, DayRecord>, from: Date, toExclusive: Date) {
  const out: DayRecord[] = [];
  const cursor = new Date(from);
  while (cursor < toExclusive) {
    const iso = toISO(cursor);
    out.push(byDate.get(iso) || { dateISO: iso, types: [] });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function MonthView({ byDate, year, month }: { byDate: Map<string, DayRecord>; year: number; month: number }) {
  const [hover, setHover] = useState<DayRecord | null>(null);
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  const prevStart = new Date(year, month - 1, 1);
  const days = daysInRange(byDate, start, end);
  const prevDays = daysInRange(byDate, prevStart, start);
  const cur = tally(days);
  const prev = tally(prevDays);
  const max = Math.max(1, ...days.map((d) => d.types.length));
  const leadingBlanks = (start.getDay() + 6) % 7; // Monday-first grid
  const todayISO = toISO(new Date());
  const prevLabel = MONTHS[prevStart.getMonth()];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <Card className="border-slate-200 bg-white/90">
        <CardHeader className="pb-2"><CardTitle className="text-base">Daily activity</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-400">
            {WEEKDAYS.map((d, i) => <div key={i}>{d}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1" onMouseLeave={() => setHover(null)}>
            {Array.from({ length: leadingBlanks }, (_, i) => <div key={`b${i}`} />)}
            {days.map((d) => {
              const future = d.dateISO > todayISO;
              return (
                <div
                  key={d.dateISO}
                  onMouseEnter={() => setHover(d)}
                  title={`${d.dateISO}: ${d.types.length ? d.types.join(", ") : "nothing logged"}`}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded text-xs",
                    future ? "bg-transparent text-slate-300 ring-1 ring-inset ring-slate-100" : heatClass(d.types.length, max),
                    !future && d.types.length / max > 0.5 ? "text-white" : "text-slate-600",
                    d.dateISO === todayISO && "ring-2 ring-indigo-400",
                  )}
                >
                  {parseISO(d.dateISO).getDate()}
                </div>
              );
            })}
          </div>
          <div className="mt-3 min-h-[2.5rem] text-xs text-slate-600">
            {hover ? (
              <>
                <span className="font-medium text-slate-900">{parseISO(hover.dateISO).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
                {" · "}
                {hover.types.length ? hover.types.join(", ") : "nothing logged"}
              </>
            ) : (
              <span className="text-slate-400">Hover a day to see what was logged. Darker = more activities.</span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Activities" value={cur.sessions} sub={<Delta current={cur.sessions} previous={prev.sessions} label={prevLabel} />} />
          <StatTile label="Active days" value={`${cur.activeDays}/${days.length}`} sub={<Delta current={cur.activeDays} previous={prev.activeDays} label={prevLabel} />} />
        </div>
        <Card className="border-slate-200 bg-white/90">
          <CardHeader className="pb-2"><CardTitle className="text-base">By activity</CardTitle></CardHeader>
          <CardContent><TypeBars totals={cur.totals} previous={prev.totals} compareLabel={prevLabel} /></CardContent>
        </Card>
      </div>
    </div>
  );
}

function YearView({ byDate, year }: { byDate: Map<string, DayRecord>; year: number }) {
  const [hoverMonth, setHoverMonth] = useState<number | null>(null);
  const [hoverDay, setHoverDay] = useState<DayRecord | null>(null);
  const days = daysInRange(byDate, new Date(year, 0, 1), new Date(year + 1, 0, 1));
  const prevDays = daysInRange(byDate, new Date(year - 1, 0, 1), new Date(year, 0, 1));
  const cur = tally(days);
  const prev = tally(prevDays);
  const todayISO = toISO(new Date());

  const monthly = MONTHS.map((_, m) => tally(days.filter((d) => parseISO(d.dateISO).getMonth() === m)));
  const monthMax = Math.max(1, ...monthly.map((m) => m.sessions));
  const dayMax = Math.max(1, ...days.map((d) => d.types.length));

  // Weeks as columns, Monday-first, GitHub-style.
  const firstMonday = getMonday(new Date(year, 0, 1));
  const weeks: (DayRecord | null)[][] = [];
  const cursor = new Date(firstMonday);
  while (cursor.getFullYear() <= year) {
    const col: (DayRecord | null)[] = [];
    for (let i = 0; i < 7; i += 1) {
      const iso = toISO(cursor);
      col.push(cursor.getFullYear() === year ? (byDate.get(iso) || { dateISO: iso, types: [] }) : null);
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(col);
  }

  // Average only over weeks since tracking began, so a mid-year start isn't diluted.
  const firstTrackedISO = Array.from(byDate.keys()).sort()[0] || todayISO;
  const trackedWeeks = weeks.filter((w) => w.some((d) => d && d.dateISO <= todayISO && d.dateISO >= toISO(getMonday(parseISO(firstTrackedISO))))).length;
  const typeRows = Array.from(cur.totals.entries()).sort((a, b) => b[1] - a[1]);
  const prevLabel = String(year - 1);
  const shown = hoverMonth !== null ? monthly[hoverMonth] : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Activities" value={cur.sessions} sub={<Delta current={cur.sessions} previous={prev.sessions} label={prevLabel} />} />
        <StatTile label="Active days" value={cur.activeDays} sub={<Delta current={cur.activeDays} previous={prev.activeDays} label={prevLabel} />} />
        <StatTile label="Best month" value={monthly.some((m) => m.sessions > 0) ? MONTHS[monthly.findIndex((m) => m.sessions === monthMax)] : "—"} sub={<span className="text-xs text-slate-500">{monthly.some((m) => m.sessions > 0) ? `${monthMax} activities` : ""}</span>} />
        <StatTile label="Weekly average" value={(cur.sessions / Math.max(1, trackedWeeks)).toFixed(1)} sub={<span className="text-xs text-slate-500">activities / week so far</span>} />
      </div>

      <Card className="border-slate-200 bg-white/90">
        <CardHeader className="pb-2"><CardTitle className="text-base">Activities per month</CardTitle></CardHeader>
        <CardContent>
          <div className="flex h-40 items-end gap-1 border-b border-slate-200 sm:gap-2" onMouseLeave={() => setHoverMonth(null)}>
            {monthly.map((m, i) => (
              <div key={i} className="flex h-full flex-1 cursor-default flex-col justify-end" onMouseEnter={() => setHoverMonth(i)}>
                {m.sessions > 0 && (hoverMonth === i || m.sessions === monthMax) ? (
                  <div className="mb-1 text-center text-[11px] tabular-nums text-slate-600">{m.sessions}</div>
                ) : null}
                <div
                  className={cn("rounded-t", hoverMonth === i ? "bg-indigo-700" : "bg-indigo-500")}
                  style={{ height: `${(m.sessions / monthMax) * 100}%`, minHeight: m.sessions > 0 ? 2 : 0 }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1 text-center text-[11px] text-slate-400 sm:gap-2">
            {MONTHS.map((m) => <div key={m} className="flex-1">{m.slice(0, 1)}<span className="hidden sm:inline">{m.slice(1)}</span></div>)}
          </div>
          <div className="mt-3 min-h-[1.25rem] text-xs text-slate-600">
            {shown && hoverMonth !== null ? (
              <><span className="font-medium text-slate-900">{MONTHS[hoverMonth]} {year}</span> · {shown.sessions} activities on {shown.activeDays} days</>
            ) : <span className="text-slate-400">Hover a month for details.</span>}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white/90">
        <CardHeader className="pb-2"><CardTitle className="text-base">Every day of {year}</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto pb-1">
            <div className="inline-flex gap-[3px]" onMouseLeave={() => setHoverDay(null)}>
              {weeks.map((col, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {col.map((d, di) => d ? (
                    <div
                      key={di}
                      onMouseEnter={() => setHoverDay(d)}
                      title={`${d.dateISO}: ${d.types.length ? d.types.join(", ") : "nothing logged"}`}
                      className={cn("h-3 w-3 rounded-sm", d.dateISO > todayISO ? "bg-slate-50" : heatClass(d.types.length, dayMax))}
                    />
                  ) : <div key={di} className="h-3 w-3" />)}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span className="min-h-[1.25rem]">
              {hoverDay ? (
                <><span className="font-medium text-slate-900">{parseISO(hoverDay.dateISO).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span> · {hoverDay.types.length ? hoverDay.types.join(", ") : "nothing logged"}</>
              ) : <span className="text-slate-400">Hover a day for details.</span>}
            </span>
            <span className="flex items-center gap-1 text-slate-400">
              Less {HEAT.map((c) => <span key={c} className={cn("inline-block h-3 w-3 rounded-sm", c)} />)} More
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white/90">
        <CardHeader className="pb-2"><CardTitle className="text-base">By activity, month by month</CardTitle></CardHeader>
        <CardContent>
          {typeRows.length === 0 ? <p className="text-sm text-slate-500">Nothing logged in {year}.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="text-[11px] text-slate-400">
                    <th className="py-1 pr-3 text-left font-normal">Activity</th>
                    {MONTHS.map((m) => <th key={m} className="px-0.5 font-normal">{m.slice(0, 1)}</th>)}
                    <th className="pl-3 text-right font-normal">Total</th>
                    <th className="pl-3 text-right font-normal">{prevLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {typeRows.map(([type, total]) => {
                    const perMonth = monthly.map((m) => m.totals.get(type) || 0);
                    const rowMax = Math.max(1, ...perMonth);
                    return (
                      <tr key={type} className="border-t border-slate-100">
                        <td className="max-w-[10rem] truncate py-1.5 pr-3 text-slate-700">{type}</td>
                        {perMonth.map((n, i) => (
                          <td key={i} className="px-0.5 py-1.5">
                            <div title={`${type}, ${MONTHS[i]}: ${n}`} className={cn("mx-auto flex h-6 w-full min-w-[1.5rem] items-center justify-center rounded text-[11px] tabular-nums", heatClass(n, rowMax), n / rowMax > 0.5 ? "text-white" : "text-slate-500")}>
                              {n || ""}
                            </div>
                          </td>
                        ))}
                        <td className="pl-3 text-right font-medium tabular-nums text-slate-900">{total}</td>
                        <td className="pl-3 text-right tabular-nums text-slate-400">{prev.totals.get(type) || 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function TrendsView({ userId, currentWeek, onBack }: { userId: string | null; currentWeek: WeeklyPlan; onBack: () => void }) {
  const [storedWeeks, setStoredWeeks] = useState<WeeklyPlan[] | null>(null);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<Mode>("month");
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  useEffect(() => {
    if (!userId) { setStoredWeeks([]); return; }
    let active = true;
    setStoredWeeks(null);
    setError(false);
    getDocs(collection(db, "users", userId, "state"))
      .then((snap) => {
        if (!active) return;
        const weeks = snap.docs
          .filter((d) => isISODate(d.id))
          .map((d) => (d.data() as PersistedState)?.weekly)
          .filter((w): w is WeeklyPlan => Boolean(w && Array.isArray(w.days)));
        setStoredWeeks(weeks);
      })
      .catch((e) => {
        console.warn("[Trends] Failed to load history", e);
        if (active) { setError(true); setStoredWeeks([]); }
      });
    return () => { active = false; };
  }, [userId]);

  // The in-memory current week is newer than whatever is stored, so it wins.
  const byDate = useMemo(() => collectDays([...(storedWeeks || []), currentWeek]), [storedWeeks, currentWeek]);

  const step = (dir: -1 | 1) => {
    if (mode === "year") { setYear((y) => y + dir); return; }
    const d = new Date(year, month + dir, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };
  const atPresent = mode === "year" ? year >= now.getFullYear() : year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-slate-600">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to tracker
        </Button>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {(["month", "year"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn("rounded-md px-3 py-1 capitalize", mode === m ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50")}
            >
              {m === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => step(-1)} aria-label="Previous period"><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="text-xl font-semibold text-slate-900">{mode === "month" ? `${MONTHS[month]} ${year}` : year}</h2>
        <Button variant="outline" size="sm" onClick={() => step(1)} disabled={atPresent} aria-label="Next period"><ChevronRight className="h-4 w-4" /></Button>
      </div>

      {storedWeeks === null ? (
        <Card className="border-slate-200 bg-white/80">
          <CardContent className="flex items-center gap-3 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your history...
          </CardContent>
        </Card>
      ) : (
        <>
          {error ? <p className="text-sm text-rose-700">Couldn't load older weeks; showing only what's on this device.</p> : null}
          {mode === "month" ? <MonthView byDate={byDate} year={year} month={month} /> : <YearView byDate={byDate} year={year} />}
        </>
      )}
    </div>
  );
}

export default TrendsView;
