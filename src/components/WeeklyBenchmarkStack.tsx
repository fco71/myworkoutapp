import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { MessageSquare } from "lucide-react";
import { WeeklyPlan } from "@/types";
import { toISO, cn } from "@/lib/workout-utils";

// Previous Week Tracker - Now editable to allow manual corrections
function PreviousWeekTracker({
  weekly,
  onUpdateWeek,
}: {
  weekly: WeeklyPlan;
  onUpdateWeek: (week: WeeklyPlan) => void;
}) {
  const types = weekly.customTypes;
  const today = toISO(new Date());

  const [commentModal, setCommentModal] = useState<{ type: string; dayIndex: number; comment: string } | null>(null);

  const openCommentModal = (type: string, dayIndex: number) => {
    setCommentModal({ type, dayIndex, comment: weekly.days[dayIndex]?.comments?.[type] || '' });
  };

  const saveComment = () => {
    if (!commentModal) return;
    const { type, dayIndex, comment } = commentModal;
    const updatedWeekly = { ...weekly, days: [...weekly.days] };
    const day = { ...updatedWeekly.days[dayIndex] };
    const comments = { ...(day.comments || {}) };
    if (comment.trim()) comments[type] = comment.trim();
    else delete comments[type];
    day.comments = comments;
    updatedWeekly.days[dayIndex] = day;
    onUpdateWeek(updatedWeekly);
    setCommentModal(null);
  };

  const toggleWorkout = (dayIndex: number, type: string) => {

    const updatedWeekly = { ...weekly };
    updatedWeekly.days = [...weekly.days];
    updatedWeekly.days[dayIndex] = { ...weekly.days[dayIndex] };

    // Toggle the workout type
    const currentValue = updatedWeekly.days[dayIndex].types?.[type] || false;

    updatedWeekly.days[dayIndex].types = {
      ...updatedWeekly.days[dayIndex].types,
      [type]: !currentValue
    };

    // Update session count and list
    const completedTypes = Object.keys(updatedWeekly.days[dayIndex].types).filter(
      t => updatedWeekly.days[dayIndex].types[t]
    );

    updatedWeekly.days[dayIndex].sessions = completedTypes.length > 0 ? 1 : 0;
    updatedWeekly.days[dayIndex].sessionsList = completedTypes.length > 0 ? [{
      sessionTypes: completedTypes
    }] : [];

    onUpdateWeek(updatedWeekly);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-800">Manual Edit Mode</h3>
        <div className="text-sm text-blue-600 bg-blue-50 px-3 py-1 rounded">
          Click checkboxes to edit from memory
        </div>
      </div>

      {/* Weekly Grid */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left p-3 border-b font-medium text-gray-700">Workout Type</th>
              {weekly.days.map((day, dayIndex) => {
                const date = new Date(day.dateISO + 'T00:00');
                const isToday = day.dateISO === today;

                return (
                  <th key={dayIndex} className={`text-center p-3 border-b font-medium min-w-[100px] ${
                    isToday ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                  }`}>
                    <div className="text-xs">{date.toLocaleDateString(undefined, { weekday: "short" })}</div>
                    <div className={`text-sm ${isToday ? 'font-bold' : ''}`}>
                      {date.getMonth() + 1}/{date.getDate()}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {types.map((type, typeIndex) => (
              <tr key={typeIndex} className="hover:bg-gray-50">
                <td className="p-3 border-b font-medium text-gray-800">
                  {type}
                </td>
                {weekly.days.map((day, dayIndex) => {
                  const isChecked = day.types?.[type] || false;
                  const hasComment = day.comments?.[type]?.trim();
                  const isToday = day.dateISO === today;

                  return (
                    <td key={dayIndex} className={`p-3 border-b text-center ${
                      isToday ? 'bg-blue-50' : ''
                    }`}>
                      <div className="flex flex-col items-center gap-1">
                        {/* Clickable Checkbox - Now editable */}
                        <button
                          onClick={() => toggleWorkout(dayIndex, type)}
                          className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors hover:shadow-md ${
                            isChecked
                              ? 'bg-green-500 border-green-500 text-white hover:bg-green-600'
                              : 'border-gray-300 bg-white hover:border-gray-400'
                          }`}
                          title="Click to toggle workout completion"
                        >
                          {isChecked && <Check className="w-4 h-4" />}
                        </button>

                        {/* Comment button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); openCommentModal(type, dayIndex); }}
                          title={hasComment ? `Comment: ${day.comments?.[type]}` : 'Add comment'}
                          className={cn(
                            "h-4 w-4 flex items-center justify-center rounded transition-opacity",
                            hasComment ? "opacity-100 text-blue-500" : "opacity-20 hover:opacity-70 text-gray-400"
                          )}
                        >
                          <MessageSquare className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Comment modal */}
      {commentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setCommentModal(null)}>
          <div className="bg-white rounded-lg p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-3">
              {commentModal.type} — {weekly.days[commentModal.dayIndex]?.dateISO}
            </h3>
            <textarea
              className="w-full border rounded p-2 text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Add a note..."
              value={commentModal.comment}
              onChange={e => setCommentModal({ ...commentModal, comment: e.target.value })}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="ghost" onClick={() => setCommentModal(null)}>Cancel</Button>
              <Button onClick={saveComment}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* Week Summary */}
      <div className="bg-gray-100 p-4 rounded-lg">
        <div className="grid grid-cols-7 gap-2">
          {weekly.days.map((day, dayIndex) => {
            const dayTypes = Object.keys(day.types || {}).filter(t => day.types[t]);
            const date = new Date(day.dateISO + 'T00:00');

            return (
              <div key={dayIndex} className="text-center p-2 bg-white rounded">
                <div className="text-xs text-gray-500 mb-1">{date.toLocaleDateString(undefined, { weekday: "short" })}</div>
                <div className="text-sm font-bold text-gray-700 mb-1">
                  {date.getDate()}
                </div>
                <div className={`text-lg font-bold ${
                  dayTypes.length > 0 ? 'text-green-600' : 'text-gray-400'
                }`}>
                  {dayTypes.length || '—'}
                </div>
                {dayTypes.length > 0 && (
                  <div className="text-xs text-gray-600 mt-1">
                    {dayTypes.slice(0, 2).join(', ')}
                    {dayTypes.length > 2 && '...'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Weekly Benchmark Stack Component - shows previous weeks using the actual WeeklyTracker format
export function WeeklyBenchmarkStack({
  previousWeeks,
  onUpdateWeek
}: {
  previousWeeks: WeeklyPlan[];
  onUpdateWeek: (week: WeeklyPlan) => void;
}) {
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [visibleCount, setVisibleCount] = useState(24); // Show 24 weeks at a time


  const toggleWeek = (weekNumber: number) => {
    const newExpanded = new Set(expandedWeeks);
    if (newExpanded.has(weekNumber)) {
      newExpanded.delete(weekNumber);
    } else {
      newExpanded.add(weekNumber);
    }
    setExpandedWeeks(newExpanded);
  };

  const loadMore = () => {
    setVisibleCount(prev => prev + 24);
  };

  // Get visible weeks (most recent first)
  const visibleWeeks = previousWeeks.slice(0, visibleCount);
  const hasMore = previousWeeks.length > visibleCount;

  // Calculate week stats for summary
  const calculateWeekStats = (weekly: WeeklyPlan) => {
    const cleanedDays = weekly.days.map(d => {
      const types: Record<string, boolean> = {};
      Object.keys(d.types || {}).forEach(k => {
        const kk = String(k).trim();
        if (kk) types[kk] = !!d.types[k];
      });
      return { ...d, types };
    });

    const weekDone = cleanedDays.reduce((acc, d) => {
      return acc + Object.keys(d.types || {}).filter(k => d.types[k]).length;
    }, 0);

    return { weekDone };
  };

  if (previousWeeks.length === 0) {
    return (
      <div className="mt-8 p-6 text-center text-gray-500 bg-gray-50 rounded-lg">
        <p>No previous weeks available</p>
        <p className="text-sm">Previous weeks will appear here as you track your workouts</p>
      </div>
    );
  }

  // Progress chart: last 16 weeks, oldest → newest (left → right)
  const chartWeeks = [...previousWeeks]
    .sort((a, b) => new Date(a.weekOfISO).getTime() - new Date(b.weekOfISO).getTime())
    .slice(-16);
  const chartData = chartWeeks.map(w => ({
    weekNum: w.weekNumber,
    done: w.days.reduce((acc, d) => acc + Object.keys(d.types || {}).filter(k => d.types[k]).length, 0),
  }));
  const maxVal = Math.max(...chartData.map(d => d.done), 1);
  const barW = 16;
  const barGap = 4;
  const chartTopPad = 10;
  const labelH = 14;
  const barAreaH = 72;
  const svgH = chartTopPad + barAreaH + labelH;
  const svgW = chartData.length * (barW + barGap) - barGap;

  return (
    <div className="space-y-4 mt-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-semibold text-gray-800">Previous Weeks</h3>
        <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
          {previousWeeks.length} weeks
        </span>
      </div>

      {chartData.length >= 2 && (
        <Card className="border border-gray-200 mb-6">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500 mb-3">Weekly activity (workouts logged)</p>
            <div className="overflow-x-auto">
              <svg
                viewBox={`0 0 ${svgW} ${svgH}`}
                style={{ width: '100%', minWidth: chartData.length * 20, height: 100 }}
                preserveAspectRatio="xMinYMid meet"
              >
                {/* Max value guideline */}
                <line
                  x1={0} y1={chartTopPad} x2={svgW} y2={chartTopPad}
                  stroke="#e5e7eb" strokeWidth={0.5} strokeDasharray="2,2"
                />
                <text x={svgW} y={chartTopPad - 2} textAnchor="end" fontSize={6} fill="#d1d5db">{maxVal}</text>
                {chartData.map((d, i) => {
                  const barH = Math.max(d.done > 0 ? (d.done / maxVal) * barAreaH : 0, d.done > 0 ? 3 : 0);
                  const x = i * (barW + barGap);
                  const y = chartTopPad + barAreaH - barH;
                  const intensity = d.done / maxVal;
                  const r = Math.round(59 + (99 - 59) * (1 - intensity));
                  const g = Math.round(130 + (102 - 130) * (1 - intensity));
                  const b = Math.round(246 + (241 - 246) * (1 - intensity));
                  const fill = d.done > 0 ? `rgb(${r},${g},${b})` : '#f3f4f6';
                  return (
                    <g key={i}>
                      <rect x={x} y={y} width={barW} height={barH} rx={2} fill={fill} />
                      <text
                        x={x + barW / 2} y={svgH - 1}
                        textAnchor="middle" fontSize={6} fill="#9ca3af"
                      >
                        {d.weekNum}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </CardContent>
        </Card>
      )}

      {visibleWeeks.map((week, index) => {
        const isExpanded = expandedWeeks.has(week.weekNumber || index);
        const stats = calculateWeekStats(week);

        return (
          <Card key={week.weekNumber || index} className="border border-gray-200 hover:border-gray-300 transition-colors">
            <CardContent className="p-0">
              {/* Collapsed Header */}
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => toggleWeek(week.weekNumber || index)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <button className="text-gray-500 hover:text-gray-700">
                      {isExpanded ? '🔽' : '▶️'}
                    </button>
                    <div>
                      <h4 className="font-semibold text-gray-800">
                        Week {week.weekNumber || `${index + 1}`}
                      </h4>
                      <p className="text-sm text-gray-500">
                        {week.days[0]?.dateISO} to {week.days[6]?.dateISO}
                      </p>
                    </div>
                  </div>

                  {/* Summary Stats */}
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-center">
                      <div className="font-bold text-blue-600 text-lg">{stats.weekDone}</div>
                      <div className="text-gray-500">Workouts</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Expanded Content - Shows the actual WeeklyTracker for that week */}
              {isExpanded && (
                <div className="border-t border-gray-100 p-6 bg-gray-50">
                  <div className="bg-white rounded-lg p-4">
                    <h5 className="text-sm font-medium text-gray-700 mb-4">
                      Week {week.weekNumber} Daily Tracker
                    </h5>

                    {/* Render the actual daily tracker interface for this week */}
                    <PreviousWeekTracker
                      weekly={week}
                      onUpdateWeek={onUpdateWeek}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Load More Button */}
      {hasMore && (
        <div className="flex justify-center pt-6">
          <Button
            onClick={loadMore}
            variant="outline"
            className="px-8 py-3 text-base"
          >
            Load More ({previousWeeks.length - visibleCount} older weeks)
          </Button>
        </div>
      )}
    </div>
  );
}
