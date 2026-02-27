import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { WeeklyPlan } from "@/types";
import { toISO } from "@/lib/workout-utils";

export function WeeklyOverview({ weekly, previousWeeks = [] }: { weekly: WeeklyPlan; previousWeeks?: WeeklyPlan[] }) {
  // normalize today's ISO (yyyy-mm-dd) using local date
  const today = toISO(new Date());

  // Counters based purely on checkbox clicks (no sessionsList/sessions):
  // Defensive: compute from a cleaned snapshot so we do strict boolean counting
  const cleanedDays = weekly.days.map(d => {
    const types: Record<string, boolean> = {};
    Object.keys(d.types || {}).forEach(k => { const kk = String(k).trim(); if (kk) types[kk] = !!d.types[k]; });
    return { ...d, types };
  });
  const todayDone = (() => {
    const td = cleanedDays.find((d) => d.dateISO === today);
    if (!td) return 0;
    // simple raw count of checked workouts for the day
    return Object.keys(td.types || {}).filter(k => td.types[k]).length;
  })();
  const weekDone = cleanedDays.reduce((acc, d) => {
    // raw count of checked workouts for the day
    return acc + Object.keys(d.types || {}).filter(k => d.types[k]).length;
  }, 0);

  // Category counts: sum clicks for types that map to a category.
  const typeCats = weekly.typeCategories || {};
  // Only count types whose category is 'Resistance' (e.g., Rings, Weights, etc.)
  // Category counts: sum checked workouts that map to the category
  const resistanceCount = cleanedDays.reduce((acc, d) => {
    return acc + Object.keys(d.types || {}).filter(t => d.types[t] && typeCats[t] === 'Resistance').length;
  }, 0);
  const cardioCount = cleanedDays.reduce((acc, d) => {
    return acc + Object.keys(d.types || {}).filter(t => d.types[t] && (typeCats[t] === 'Cardio' || t === 'Bike' || t === 'Cardio')).length;
  }, 0);
  const mindfulnessCount = cleanedDays.reduce((acc, d) => {
    return acc + Object.keys(d.types || {}).filter(t => d.types[t] && (typeCats[t] === 'Mindfulness' || t === 'Mindfulness')).length;
  }, 0);

  // Only show summary cards for categories that have at least one mapped type
  const hasResistanceCategory = Object.values(typeCats).some((v) => v === 'Resistance');
  const hasCardioCategory = Object.values(typeCats).some((v) => v === 'Cardio');
  const hasMindfulnessCategory = Object.values(typeCats).some((v) => v === 'Mindfulness');

  // Streak: consecutive weeks (ending at most recent active week) with at least one workout
  const streak = useMemo(() => {
    const weekActivity = (w: WeeklyPlan) =>
      w.days.reduce((acc, d) => acc + Object.keys(d.types || {}).filter(k => d.types[k]).length, 0);
    const allWeeks = [weekly, ...previousWeeks].sort(
      (a, b) => new Date(b.weekOfISO).getTime() - new Date(a.weekOfISO).getTime()
    );
    // If current week has no activity yet, start counting from last week
    const startIdx = weekActivity(allWeeks[0]) === 0 ? 1 : 0;
    let count = 0;
    for (let i = startIdx; i < allWeeks.length; i++) {
      if (weekActivity(allWeeks[i]) > 0) count++;
      else break;
    }
    return count;
  }, [weekly, previousWeeks]);

  return (
    <div className="space-y-4 mb-8">
      {/* Week Number */}
      <div className="flex items-center justify-between">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold">Week {weekly.weekNumber}</h2>
        </div>
      </div>

  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Today's Progress */}
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm font-medium">Today</p>
                <p className="text-3xl font-bold">{todayDone}</p>
                <p className="text-blue-200 text-xs">Done today</p>
              </div>
              <div className="w-12 h-12 bg-blue-400 rounded-full flex items-center justify-center">
                <span className="text-2xl">🏋️</span>
              </div>
            </div>
          </CardContent>
        </Card>

      {/* Week Progress */}
      <Card className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border-0 shadow-lg">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-indigo-100 text-sm font-medium">This Week</p>
              <p className="text-3xl font-bold">{weekDone}</p>
              <p className="text-indigo-200 text-xs">Done this week</p>
            </div>
            <div className="w-12 h-12 bg-indigo-400 rounded-full flex items-center justify-center">
              <span className="text-2xl">📊</span>
            </div>
          </div>
        </CardContent>
      </Card>

  {/* Streak */}
      {streak > 0 && (
        <Card className="bg-gradient-to-br from-amber-500 to-amber-600 text-white border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-amber-100 text-sm font-medium">Streak</p>
                <p className="text-3xl font-bold">{streak}</p>
                <p className="text-amber-200 text-xs">{streak === 1 ? 'week' : 'weeks'}</p>
              </div>
              <div className="w-12 h-12 bg-amber-400 rounded-full flex items-center justify-center">
                <span className="text-2xl">🔥</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

  {/* Resistance Progress */}
      {hasResistanceCategory && (
        <Card className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-emerald-100 text-sm font-medium">Resistance Training</p>
                <p className="text-3xl font-bold">{resistanceCount}</p>
                <p className="text-emerald-200 text-xs">Done this week</p>
              </div>
              <div className="w-12 h-12 bg-emerald-400 rounded-full flex items-center justify-center">
                <span className="text-2xl">💪</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cardio Progress */}
      {hasCardioCategory && (
        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-sm font-medium">Cardio</p>
                <p className="text-3xl font-bold">{cardioCount}</p>
                <p className="text-orange-200 text-xs">Done this week</p>
              </div>
              <div className="w-12 h-12 bg-orange-400 rounded-full flex items-center justify-center">
                <span className="text-2xl">🏃</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {/* Mindfulness Progress */}
      {hasMindfulnessCategory && (
        <Card className="bg-gradient-to-br from-emerald-300 to-emerald-400 text-white border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-emerald-100 text-sm font-medium">Mindfulness</p>
                <div className="flex items-center gap-2">
                  <p className="text-3xl font-bold">{mindfulnessCount}</p>
                  {/* inline info icon removed per request; tooltip is available in Manage types help */}
                </div>
                <p className="text-emerald-200 text-xs">Done this week</p>
              </div>
              <div className="w-12 h-12 bg-emerald-200 rounded-full flex items-center justify-center">
                <span className="text-2xl">🧘</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
