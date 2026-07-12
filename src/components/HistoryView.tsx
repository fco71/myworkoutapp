import { useMemo, useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, collection, getDocs, deleteDoc, query, where, orderBy } from "firebase/firestore";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Edit } from "lucide-react";
import { WeeklyPlan, ResistanceSession } from "@/types";
import {
  cn,
  toISO,
  getMonday,
  useToasts,
  normalizeWeekly,
} from "@/lib/workout-utils";

export function HistoryView({
  weekly,
  setWeekly,
  setSession,
  previousWeeks,
  onOpenWorkoutTab,
}: {
  weekly: WeeklyPlan;
  setWeekly: (w: WeeklyPlan) => void;
  setSession: (s: ResistanceSession) => void;
  previousWeeks: WeeklyPlan[];
  onOpenWorkoutTab?: () => void;
}) {
  const toasts = useToasts();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [showAllHistoryDays, setShowAllHistoryDays] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let mounted = true;

    async function loadSessions() {
      try {
        setLoading(true);
        const uid = auth.currentUser?.uid;

        let displaySessions: any[] = [];

        // Load real saved sessions first — these carry the actual exercises, sets and
        // intensity, and can be reopened/edited. They take priority over the weekly grid.
        let firestoreSessions: any[] = [];
        if (uid) {
          try {
            const q = query(
              collection(db, 'users', uid, 'sessions'),
              where('completedAt', '!=', null),
              orderBy('completedAt', 'desc')
            );

            const snapshot = await getDocs(q);
            firestoreSessions = snapshot.docs.map(doc => {
              const data: any = doc.data();
              const dateISO = data.dateISO || (data.completedAt?.toDate ? toISO(data.completedAt.toDate()) : null);
              return { id: doc.id, ...data, dateISO, source: 'firestore' };
            });
          } catch (error) {
            console.warn('HistoryView: Failed to load Firestore sessions:', error);
          }
        }

        // Which activity types are already represented by a saved session on each date,
        // so we don't also draw an empty weekly-grid card for the same thing.
        const coveredTypesByDate = new Map<string, Set<string>>();
        firestoreSessions.forEach((fs: any) => {
          if (!fs.dateISO) return;
          const set = coveredTypesByDate.get(fs.dateISO) || new Set<string>();
          (fs.sessionTypes || []).forEach((t: string) => set.add(t));
          coveredTypesByDate.set(fs.dateISO, set);
        });

        // Synthesize weekly-grid cards only for activity types NOT covered by a saved session
        // (e.g. a Bike/Cardio tap that never became a full workout). Works without auth too.
        const allWeeklyData = [weekly, ...previousWeeks];
        allWeeklyData.forEach((weekData) => {
          weekData.days?.forEach((day: any) => {
            const activeTypes = day.types ? Object.keys(day.types).filter(t => day.types[t]) : [];
            const covered = coveredTypesByDate.get(day.dateISO) || new Set<string>();
            const remainingTypes = activeTypes.filter(t => !covered.has(t));

            if (remainingTypes.length > 0) {
              displaySessions.push({
                id: `daily:${day.dateISO}:${remainingTypes.join('-')}`,
                dateISO: day.dateISO,
                sessionName: remainingTypes.join(' + '),
                sessionTypes: remainingTypes,
                completed: true,
                exercises: [],
                durationSec: 0,
                completedAt: new Date(day.dateISO + 'T12:00:00'),
                source: 'weekly_tracker_types'
              });
            }
          });
        });

        // Append the real saved sessions (with their exercises intact).
        displaySessions.push(...firestoreSessions);

        if (mounted) {
          setItems(displaySessions);
          setLoading(false);
        }
      } catch (error) {
        console.error('Failed to load sessions:', error);
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadSessions();
    return () => { mounted = false; };
  }, [weekly, previousWeeks]);

  const toggleWeek = (weekKey: string) => {
    const newExpanded = new Set(expandedWeeks);
    if (newExpanded.has(weekKey)) {
      newExpanded.delete(weekKey);
    } else {
      newExpanded.add(weekKey);
    }
    setExpandedWeeks(newExpanded);
  };

  const toggleDay = (dayKey: string) => {
    const newExpanded = new Set(expandedDays);
    if (newExpanded.has(dayKey)) {
      newExpanded.delete(dayKey);
    } else {
      newExpanded.add(dayKey);
    }
    setExpandedDays(newExpanded);
  };

  // Group sessions by week, then by day
  const groupedSessions = useMemo(() => {
    const groups: Record<string, Record<string, any[]>> = {};

    items.forEach(session => {
      // Use dateISO directly if available to avoid timezone conversion issues
      let dayKey: string;
      if (session.dateISO) {
        dayKey = session.dateISO;
      } else {
        const date = new Date(session.completedAt || session.ts);
        dayKey = toISO(date);
      }

      // Calculate week key from the day's ISO date (avoid Date object conversion)
      const [year, month, day] = dayKey.split('-').map(Number);
      const date = new Date(year, month - 1, day); // Local date from ISO parts
      const monday = getMonday(date);
      const weekKey = toISO(monday);

      if (!groups[weekKey]) groups[weekKey] = {};
      if (!groups[weekKey][dayKey]) groups[weekKey][dayKey] = [];
      groups[weekKey][dayKey].push(session);
    });

    return groups;
  }, [items]);

  const getTypeColor = (sessionTypes: string[]) => {
    const typeColorMap: Record<string, string> = {
      'Resistance': 'bg-emerald-100 border-emerald-400 text-emerald-800',
      'Bike': 'bg-blue-100 border-blue-400 text-blue-800',
      'Cardio': 'bg-orange-100 border-orange-400 text-orange-800',
      'Calves': 'bg-purple-100 border-purple-400 text-purple-800',
      'Meditation': 'bg-indigo-100 border-indigo-400 text-indigo-800',
      'Guitar': 'bg-amber-100 border-amber-400 text-amber-800',
      'Mindfulness': 'bg-teal-100 border-teal-400 text-teal-800',
    };

    // If multiple types, use a mixed color
    if (sessionTypes.length > 1) {
      return 'bg-gradient-to-r from-blue-100 to-purple-100 border-blue-400 text-blue-800';
    }

    return typeColorMap[sessionTypes[0]] || 'bg-gray-100 border-gray-300 text-gray-700';
  };

  if (loading) return <div className="p-4 text-center text-gray-500">Loading history...</div>;
  if (items.length === 0) return <div className="text-sm text-neutral-600">No history yet. Complete sessions will appear here.</div>;

  const sortedWeeks = Object.keys(groupedSessions).sort().reverse();

  const exportCSV = () => {
    const rows: string[][] = [['Date', 'Session', 'Types', 'Exercise', 'Set', 'Reps', 'Duration (min)']];
    items.forEach(item => {
      const completedAtDate = item.completedAt?.toDate?.();
      const date = item.dateISO || (completedAtDate ? toISO(completedAtDate) : '');
      const name = item.sessionName || 'Manual';
      const types = (item.sessionTypes || []).join('; ');
      const durationMin = item.durationSec ? Math.round(item.durationSec / 60) : '';
      if (item.exercises && item.exercises.length > 0) {
        item.exercises.forEach((ex: any) => {
          (ex.sets || []).forEach((reps: number, i: number) => {
            rows.push([date, name, types, ex.name || '', String(i + 1), String(reps), i === 0 ? String(durationMin) : '']);
          });
          if (!ex.sets || ex.sets.length === 0) {
            rows.push([date, name, types, ex.name || '', '', '', String(durationMin)]);
          }
        });
      } else {
        rows.push([date, name, types, '', '', '', String(durationMin)]);
      }
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workout-history-${toISO(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {sortedWeeks.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Session History ({items.length} sessions)</h3>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              Export CSV
            </Button>
          </div>
          {sortedWeeks.map((weekKey) => {
        const weekData = groupedSessions[weekKey];
        // Parse ISO date properly to avoid timezone issues
        const [year, month, day] = weekKey.split('-').map(Number);
        const weekStart = new Date(year, month - 1, day);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const isExpanded = expandedWeeks.has(weekKey);

        const totalSessions = Object.values(weekData).flat().length;
        const totalDays = Object.keys(weekData).length;

        return (
          <Card key={weekKey} className="border-2 transition-all duration-200">
            <CardHeader
              className="cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => toggleWeek(weekKey)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">
                    Week of {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </CardTitle>
                  <div className="text-sm text-gray-600">
                    {totalSessions} sessions across {totalDays} days
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0">
                <div className="space-y-3">
                  {Object.keys(weekData).sort().map((dateISO) => {
                    const daySessions = weekData[dateISO];
                    const dayKey = `${weekKey}-${dateISO}`;
                    const isDayExpanded = expandedDays.has(dayKey);
                    // Parse ISO date properly to avoid timezone issues
                    const [year, month, day] = dateISO.split('-').map(Number);
                    const date = new Date(year, month - 1, day);
                    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });

                    return (
                      <div key={dateISO} className="border rounded-lg">
                        <div
                          className="p-3 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between"
                          onClick={() => toggleDay(dayKey)}
                        >
                          <div>
                            <div className="font-medium">{dayName}, {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                            <div className="text-sm text-gray-600">{daySessions.length} session{daySessions.length !== 1 ? 's' : ''}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex gap-1">
                              {Array.from(new Set(daySessions.flatMap((s: any) => s.sessionTypes || []))).map((type: any) => (
                                <span key={type} className={cn('px-2 py-1 rounded-full text-xs font-medium border', getTypeColor([type]))}>
                                  {type}
                                </span>
                              ))}
                            </div>
                            {isDayExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </div>
                        </div>

                        {isDayExpanded && (
                          <div className="px-3 pb-3 space-y-2">
                            {(showAllHistoryDays[dayKey] ? daySessions : daySessions.slice(0, 3)).map((session: any) => (
                              <Card key={session.id} className={cn('border', getTypeColor(session.sessionTypes || []))}>
                                <CardHeader className="pb-2">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="font-semibold">{session.sessionName}</div>
                                      {session.source !== 'weekly_tracker_types' && session.completedAt && (
                                        <div className="text-xs text-neutral-600">
                                          {new Date(session.completedAt).toLocaleTimeString()}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {session.exercises && session.exercises.length > 0 && (
                                        <div className="text-sm text-neutral-600">{session.exercises.length} exercises</div>
                                      )}
                                      {/* Only real saved sessions carry exercises and a real doc id to reopen/edit. */}
                                      {session.source === 'firestore' && (
                                        <>
                                          <Button variant="outline" size="sm" onClick={(e) => {
                                            e.stopPropagation();
                                            // Reopen this saved workout to continue/edit it. sourceSessionId makes the
                                            // next Save update this same history entry instead of creating a duplicate.
                                            const editableSession: ResistanceSession = {
                                              dateISO: session.dateISO || toISO(new Date()),
                                              sessionName: session.sessionName || 'Workout',
                                              exercises: session.exercises || [],
                                              completed: false, // reopen for editing
                                              sessionTypes: session.sessionTypes || [],
                                              durationSec: session.durationSec || 0, // preserve original elapsed time
                                              startedAt: undefined,
                                              completedAt: undefined,
                                              sourceTemplateId: session.sourceTemplateId,
                                              sourceSessionId: session.id,
                                            };
                                            setSession(editableSession);
                                            onOpenWorkoutTab?.();
                                            toasts.push('Opened for editing. Change it and press Save to update, or Start to resume timing.', 'success');
                                          }}>
                                            <Edit className="h-3 w-3 mr-1" />
                                            Continue / Edit
                                          </Button>
                                          <Button variant="destructive" size="sm" onClick={async (e) => {
                                            e.stopPropagation();
                                            if (!confirm('Delete this session?')) return;
                                            try {
                                              const uid = auth.currentUser?.uid;
                                              if (!uid) return toasts.push('Sign in to delete', 'info');
                                              await deleteDoc(doc(db, 'users', uid, 'sessions', session.id));
                                              // remove from local weekly state
                                              const days = weekly.days.map(d => ({ ...d, sessionsList: (d.sessionsList || []).filter(s => s.id !== session.id) }));
                                              const newWeekly = normalizeWeekly({ ...weekly, days } as WeeklyPlan);
                                              setWeekly(newWeekly);
                                              // remove from history list
                                              setItems(prev => prev.filter(x => x.id !== session.id));
                                            } catch (e) {
                                              console.error('Delete session failed', e);
                                              toasts.push('Delete failed - see console', 'error');
                                            }
                                          }}>Delete</Button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </CardHeader>
                                <CardContent className="pt-0">
                                  <div className="text-sm">
                                    {(session.sessionTypes || []).join(', ')}
                                  </div>
                                  {session.exercises && session.exercises.length > 0 && (
                                    <div className="mt-2 text-xs text-gray-600">
                                      <div className="font-medium mb-1">Exercises:</div>
                                      <div className="space-y-1">
                                        {session.exercises.map((ex: any, i: number) => (
                                          <div key={i} className="flex justify-between">
                                            <span>{ex.name}</span>
                                            <span>{ex.sets?.join(', ') || 'No sets'} (Intensity: {ex.intensity || 0})</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </CardContent>
                              </Card>
                            ))}
                            {daySessions.length > 3 && (
                              <Button variant="ghost" size="sm" onClick={() => setShowAllHistoryDays(prev => ({ ...prev, [dayKey]: !prev[dayKey] }))}>
                                {showAllHistoryDays[dayKey] ? 'Show Less' : 'More History'}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
        </div>
      )}
    </div>
  );
}
