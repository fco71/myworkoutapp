import { useMemo, useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc, collection, addDoc, getDocs, deleteDoc, getDoc } from "firebase/firestore";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Trash2,
  Check,
  Save,
  Bookmark,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  CalendarDays,
  Play,
  Pause,
  RotateCcw,
  Dumbbell,
  Activity,
  TimerReset,
  Trophy,
  Sparkles,
  ListChecks,
} from "lucide-react";
import { ResistanceExercise, ResistanceSession, WeeklyPlan } from "@/types";
import {
  cn,
  useToasts,
  loadLocalRoutines,
  saveLocalRoutine,
  defaultSession,
  completedGuards,
} from "@/lib/workout-utils";
import { playWorkoutCompletionSound } from "@/lib/audio";

function getExerciseProgress(exercise: ResistanceExercise) {
  const sum = exercise.sets.reduce((total, reps) => total + (reps || 0), 0);
  const firstTargetSets = exercise.sets.slice(0, exercise.minSets);
  const allFirstSetsMeetTarget =
    firstTargetSets.length >= exercise.minSets &&
    firstTargetSets.every((reps) => reps >= exercise.targetReps);
  const totalTarget = exercise.minSets * exercise.targetReps;
  const goalMet = allFirstSetsMeetTarget || sum >= totalTarget;

  return {
    sum,
    totalTarget,
    goalMet,
    progressPercent: totalTarget > 0 ? Math.min(100, Math.round((sum / totalTarget) * 100)) : 0,
  };
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function ExerciseCard({
  ex,
  updateExercise,
  updateSet,
  addSet,
  removeSet,
  onDelete,
}: {
  ex: ResistanceExercise;
  updateExercise: (id: string, patch: Partial<ResistanceExercise>) => void;
  updateSet: (id: string, setIndex: number, value: number) => void;
  addSet: (id: string) => void;
  removeSet: (id: string, setIndex: number) => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const setOK = (rep: number) => rep >= ex.targetReps;
  const { sum, totalTarget, goalMet, progressPercent } = getExerciseProgress(ex);

  // Exercise history state
  const [exerciseHistory, setExerciseHistory] = useState<{lastWorkout?: any; personalRecord?: any; recentWorkouts?: any[]}>({});
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Load exercise history
  useEffect(() => {
    const loadHistory = async () => {
      // Don't load history for invalid exercise names
      const exerciseName = ex.name.trim();
      const isValidExerciseName = exerciseName &&
        exerciseName !== 'Min sets' &&
        exerciseName !== 'Target reps' &&
        exerciseName !== 'Intensity' &&
        exerciseName !== 'New exercise' &&
        exerciseName.length >= 2; // Minimum length check

      if (!isValidExerciseName || historyLoading) {
        setExerciseHistory({});
        return;
      }

      setHistoryLoading(true);
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) {
          return;
        }


        // Query sessions that contain this exercise
        const sessionsRef = collection(db, 'users', uid, 'sessions');
        const snaps = await getDocs(sessionsRef);

        // Debug: Log all sessions
        const sessionsWithExercises = snaps.docs.filter(doc => {
          const data = doc.data();
          return data.exercises && data.exercises.length > 0;
        });

        if (sessionsWithExercises.length > 0) {
          const allExerciseNames = new Set();
          sessionsWithExercises.forEach(doc => {
            const data = doc.data();
            data.exercises?.forEach((e: any) => {
              const cleanName = (e.name || '').replace(/['"]/g, '').trim();
              allExerciseNames.add(cleanName);
            });
          });

          // Special debugging for specific exercises
          if (exerciseName.toLowerCase().includes('bodyweight') || exerciseName.toLowerCase().includes('ring')) {
            Array.from(allExerciseNames).forEach((name) => {
              const nameStr = String(name);
              if (nameStr.toLowerCase().includes('bodyweight') || nameStr.toLowerCase().includes('ring') || nameStr.toLowerCase().includes('row') || nameStr.toLowerCase().includes('rollout')) {
              }
            });
          }
        }

        const matchingSessions = snaps.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((session: any) => {
            // Only include completed sessions
            const hasCompletedAt = !!session.completedAt;
            const hasMatchingExercise = session.exercises?.some((e: any) => {
              // Clean exercise names by removing quotes and normalizing
              const cleanStoredName = (e.name || '').replace(/['"]/g, '').toLowerCase().trim();
              const cleanSearchName = exerciseName.toLowerCase().trim();

              // Debug logging for specific exercises
              if (exerciseName.toLowerCase().includes('bodyweight') || exerciseName.toLowerCase().includes('ring')) {
              }

              // Exact match
              if (cleanStoredName === cleanSearchName) {
                return true;
              }

              // Fuzzy matching for common variations
              const storedWords = cleanStoredName.split(/\s+/);
              const searchWords = cleanSearchName.split(/\s+/);

              // Handle singular/plural variations
              const normalize = (word: string) => word.replace(/s$/, ''); // Remove trailing 's'

              // Check if all search words match stored words (with fuzzy matching)
              const fuzzyMatch = searchWords.every((searchWord: string) =>
                storedWords.some((storedWord: string) =>
                  normalize(storedWord) === normalize(searchWord) ||
                  storedWord === searchWord ||
                  searchWord === storedWord
                )
              );

              if (fuzzyMatch && (exerciseName.toLowerCase().includes('bodyweight') || exerciseName.toLowerCase().includes('ring'))) {
              }

              return fuzzyMatch;
            });
            if (session.exercises) {
            }
            return hasCompletedAt && hasMatchingExercise;
          })
          .sort((a: any, b: any) => (b.completedAt || 0) - (a.completedAt || 0));


        if (matchingSessions.length > 0) {
          // Get the exercise data from matching sessions
          const exerciseInstances = matchingSessions.map((session: any) => {
            const exercise = session.exercises.find((e: any) => {
              const cleanStoredName = (e.name || '').replace(/['"]/g, '').toLowerCase().trim();
              const cleanSearchName = ex.name.toLowerCase().trim();

              // Exact match
              if (cleanStoredName === cleanSearchName) return true;

              // Fuzzy matching for common variations
              const storedWords = cleanStoredName.split(/\s+/);
              const searchWords = cleanSearchName.split(/\s+/);

              // Handle singular/plural variations
              const normalize = (word: string) => word.replace(/s$/, ''); // Remove trailing 's'

              // Check if all search words match stored words (with fuzzy matching)
              return searchWords.every((searchWord: string) =>
                storedWords.some((storedWord: string) =>
                  normalize(storedWord) === normalize(searchWord) ||
                  storedWord === searchWord ||
                  searchWord === storedWord
                )
              );
            });
            return {
              ...exercise,
              sessionDate: new Date(session.completedAt),
              sessionName: session.sessionName,
              sessionId: session.id
            };
          }).filter(Boolean);


          // Find last workout (most recent completed)
          const lastWorkout = exerciseInstances[0];

          // Find personal record (highest total reps)
          const personalRecord = exerciseInstances.reduce((best: any, current: any) => {
            const currentTotal = (current.sets || []).reduce((sum: number, reps: number) => sum + reps, 0);
            const bestTotal = (best?.sets || []).reduce((sum: number, reps: number) => sum + reps, 0);
            return currentTotal > bestTotal ? current : best;
          }, null);

          // Get recent workouts (last 5 completed sessions, excluding duplicates)
          const uniqueSessions = new Map();
          exerciseInstances.forEach((instance: any) => {
            const key = `${instance.sessionId}-${instance.sessionDate.getTime()}`;
            if (!uniqueSessions.has(key)) {
              uniqueSessions.set(key, instance);
            }
          });
          const recentWorkouts = Array.from(uniqueSessions.values()).slice(0, 5);

          const historyData = {
            lastWorkout,
            personalRecord: personalRecord?.sets?.length ? personalRecord : null,
            recentWorkouts
          };

          setExerciseHistory(historyData);
        } else {
          // Clear history if no completed sessions found
          setExerciseHistory({});
        }
      } catch (error) {
        console.error('Failed to load exercise history:', error);
      } finally {
        setHistoryLoading(false);
      }
    };

    // Only load history for valid exercise names
    const exerciseName = ex.name.trim();
    const isValidExerciseName = exerciseName &&
      exerciseName !== 'Min sets' &&
      exerciseName !== 'Target reps' &&
      exerciseName !== 'Intensity' &&
      exerciseName !== 'New exercise' &&
      exerciseName.length >= 2;

    if (isValidExerciseName) {
      loadHistory();
    } else {
      // Clear history for invalid names
      setExerciseHistory({});
    }
  }, [ex.name]);

  const { lastWorkout, personalRecord, recentWorkouts } = exerciseHistory;
  const hasHistory = lastWorkout || personalRecord || (recentWorkouts && recentWorkouts.length > 0);
  const hasExtendedHistory = Boolean((recentWorkouts && recentWorkouts.length > 1) || personalRecord);

  return (
    <Card
      className={cn(
        "overflow-hidden border shadow-lg transition-all duration-300",
        goalMet
          ? "border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-lime-50 shadow-emerald-100"
          : "border-slate-200 bg-gradient-to-br from-white via-slate-50 to-sky-50 shadow-slate-100"
      )}
    >
      <CardHeader className="gap-5 border-b border-white/70 bg-white/75 backdrop-blur-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
                  goalMet ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"
                )}
              >
                {goalMet ? "On target" : "In progress"}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {ex.sets.length} sets tracked
              </span>
              {lastWorkout?.sessionDate && (
                <span className="inline-flex items-center rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700">
                  Last done {lastWorkout.sessionDate.toLocaleDateString()}
                </span>
              )}
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.55fr))]">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Exercise</label>
                <Input
                  value={ex.name || ""}
                  onChange={(e) => updateExercise(ex.id, { name: e.target.value })}
                  placeholder="Enter exercise name (e.g., Push ups, Bodyweight Row)"
                  className="h-12 border-slate-200 bg-white text-base font-semibold shadow-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Min sets</label>
                <Input
                  type="number"
                  className="h-12 border-slate-200 bg-white text-center text-base font-semibold shadow-sm"
                  value={ex.minSets}
                  min={1}
                  onChange={(e) => updateExercise(ex.id, { minSets: Math.max(1, parseInt(e.target.value || "1")) })}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Target reps</label>
                <Input
                  type="number"
                  className="h-12 border-slate-200 bg-white text-center text-base font-semibold shadow-sm"
                  value={ex.targetReps}
                  min={1}
                  onChange={(e) => updateExercise(ex.id, { targetReps: Math.max(1, parseInt(e.target.value || "1")) })}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Intensity</label>
                <Input
                  type="number"
                  className="h-12 border-slate-200 bg-white text-center text-base font-semibold shadow-sm"
                  value={ex.intensity || 0}
                  min={0}
                  max={999}
                  placeholder="0"
                  onChange={(e) =>
                    updateExercise(ex.id, { intensity: Math.max(0, Math.min(999, parseInt(e.target.value || "0"))) })
                  }
                />
              </div>
            </div>
          </div>

          <div className="w-full rounded-3xl bg-slate-950/95 p-5 text-white shadow-xl xl:max-w-sm">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
              <span>Progress</span>
              <span>{sum} / {totalTarget}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  goalMet ? "bg-emerald-400" : "bg-sky-400"
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-white/10 px-3 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-300">Status</div>
                <div className="mt-1 font-semibold text-white">{goalMet ? "Goal met" : "Keep pushing"}</div>
              </div>
              <div className="rounded-2xl bg-white/10 px-3 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-300">Volume</div>
                <div className="mt-1 font-semibold text-white">{ex.sets.length} sets logged</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {confirmDelete ? (
                <>
                  <span className="text-sm font-medium text-rose-200">Remove this exercise?</span>
                  <Button variant="destructive" size="sm" onClick={onDelete}>
                    Yes, remove
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Keep it
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Remove exercise
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ex.sets.map((rep, i) => (
            <div
              key={i}
              className={cn(
                "rounded-3xl border p-4 shadow-sm transition-all",
                setOK(rep)
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-slate-200 bg-white"
              )}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Set {i + 1}</div>
                  <div className="mt-1 text-sm text-slate-600">Target {ex.targetReps} reps</div>
                </div>
                {setOK(rep) && (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Hit
                  </span>
                )}
              </div>

              <Input
                type="number"
                className={cn(
                  "mt-4 h-14 border-2 text-center text-2xl font-semibold shadow-sm",
                  setOK(rep)
                    ? "border-emerald-300 bg-white text-emerald-900"
                    : "border-slate-200 bg-slate-50 text-slate-900"
                )}
                value={rep}
                onChange={(e) => updateSet(ex.id, i, Math.max(0, parseInt(e.target.value || "0")))}
              />

              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Previous {lastWorkout && lastWorkout.sets && lastWorkout.sets[i] !== undefined ? lastWorkout.sets[i] : "--"}
                </span>
                <button
                  type="button"
                  className="font-semibold text-rose-600 transition hover:text-rose-700"
                  onClick={() => removeSet(ex.id, i)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => addSet(ex.id)}
            className="flex min-h-[194px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-sky-300 bg-sky-50/70 p-4 text-sky-700 transition hover:border-sky-400 hover:bg-sky-100/70"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
              <Plus className="h-5 w-5" />
            </span>
            <div className="text-sm font-semibold">Add another set</div>
            <div className="text-xs text-sky-600">Keep the flow without opening more controls.</div>
          </button>
        </div>

        {lastWorkout && lastWorkout.sets && lastWorkout.sets.length > 0 && (
          <div className="rounded-3xl border border-sky-200 bg-sky-50/80 p-4 text-sm text-sky-900">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Last session reference</div>
                <div className="mt-1 font-semibold">{lastWorkout.sessionDate.toLocaleDateString()}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-sky-800">
                <span className="rounded-full bg-white px-3 py-1 shadow-sm">
                  Total {lastWorkout.sets.reduce((total: number, reps: number) => total + reps, 0)} reps
                </span>
                {lastWorkout.intensity ? (
                  <span className="rounded-full bg-white px-3 py-1 shadow-sm">Intensity {lastWorkout.intensity}</span>
                ) : null}
                {lastWorkout.sets.map((reps: number, index: number) => (
                  <span key={index} className="rounded-full bg-white px-3 py-1 shadow-sm">
                    {reps}
                  </span>
                ))}
              </div>
            </div>
            {lastWorkout.notes && (
              <div className="mt-3 rounded-2xl bg-white/80 px-3 py-2 text-xs text-sky-900 shadow-sm">
                <span className="font-semibold">Notes:</span> {lastWorkout.notes}
              </div>
            )}
          </div>
        )}

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-800">Notes and cues</span>
          </div>
          <Input
            placeholder="Add form cues, weight used, or quick reminders for next time"
            value={ex.notes || ""}
            onChange={(e) => updateExercise(ex.id, { notes: e.target.value })}
            className="border-slate-200 bg-slate-50"
          />
        </div>

        {!ex.name.trim() || ex.name === "New exercise" ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
            Tip: name the exercise to unlock previous-session context and make this card easier to scan later.
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          Rule: a set is complete once it reaches target reps. The card is complete when the first <strong>min sets</strong>
          {" "}all hit target or total reps reach <em>min sets x target reps</em>.
        </div>

        {hasHistory && hasExtendedHistory && (
          <div className="border-t border-slate-200 pt-4">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100"
              onClick={() => setHistoryExpanded(!historyExpanded)}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">More history</span>
                {recentWorkouts && recentWorkouts.length > 1 ? (
                  <span className="text-xs text-slate-500">({recentWorkouts.length - 1} previous sessions)</span>
                ) : null}
                {historyLoading ? <span className="text-xs text-slate-500">Loading...</span> : null}
              </div>
              {historyExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>

            {historyExpanded && !historyLoading && (
              <div className="mt-4 space-y-3">
                {personalRecord && personalRecord !== lastWorkout && (
                  <div className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                      <Trophy className="h-4 w-4" />
                      Personal record ({personalRecord.sessionDate.toLocaleDateString()})
                    </h4>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                      {(personalRecord.sets || []).map((reps: number, i: number) => (
                        <div key={i} className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-900">
                          {reps}
                        </div>
                      ))}
                      <span className="text-xs font-medium text-amber-700">
                        Total {(personalRecord.sets || []).reduce((total: number, reps: number) => total + reps, 0)} reps
                      </span>
                      {personalRecord.intensity ? (
                        <span className="text-xs font-medium text-amber-700">Intensity {personalRecord.intensity}</span>
                      ) : null}
                    </div>
                    {personalRecord.notes && (
                      <div className="mt-3 rounded-2xl bg-amber-100/80 px-3 py-2 text-xs text-amber-900">
                        <span className="font-semibold">Notes:</span> {personalRecord.notes}
                      </div>
                    )}
                  </div>
                )}

                {recentWorkouts && recentWorkouts.length > 1 && (
                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <h4 className="text-sm font-semibold text-slate-800">Previous sessions</h4>
                    <div className="mt-3 space-y-2">
                      {recentWorkouts.slice(1).map((workout: any, i: number) => (
                        <div
                          key={`${workout.sessionId}-${i}`}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm"
                        >
                          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <span className="font-semibold text-slate-700">{workout.sessionDate.toLocaleDateString()}</span>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                              {(workout.sets || []).map((reps: number, j: number) => (
                                <span key={j} className="rounded-full bg-white px-2.5 py-1 font-medium shadow-sm">
                                  {reps}
                                </span>
                              ))}
                              {workout.intensity ? (
                                <span className="font-medium text-slate-500">Intensity {workout.intensity}</span>
                              ) : null}
                              <span className="font-medium text-slate-500">
                                Total {(workout.sets || []).reduce((total: number, reps: number) => total + reps, 0)}
                              </span>
                            </div>
                          </div>
                          {workout.notes && (
                            <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs text-slate-600 shadow-sm">
                              <span className="font-semibold">Notes:</span> {workout.notes}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function WorkoutView({
  session,
  setSession,
  weekly,
  setWeekly,
  userName,
}: {
  session: ResistanceSession;
  setSession: (s: ResistanceSession) => void;
  weekly: WeeklyPlan;
  setWeekly: (w: WeeklyPlan) => void;
  userName: string | null;
}) {
  const toasts = useToasts();
  const [pendingFavorites, setPendingFavorites] = useState<Set<string>>(new Set());
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSec, setTimerSec] = useState<number>(session.durationSec || 0);
  const [routines, setRoutines] = useState<any[]>([]);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);
  const [sessionFavorited, setSessionFavorited] = useState<boolean>(false);

  // Save routine dialog state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [routineName, setRoutineName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let id: any = null;
    if (timerRunning) {
      id = setInterval(() => setTimerSec((s) => s + 1), 1000);
    }
    return () => {
      if (id) clearInterval(id);
    };
  }, [timerRunning]);

  // initialize whether current session (template) is favorited by the user
  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    const initFav = async () => {
      try {
        const uid = auth.currentUser?.uid;
        const itemId = session.sourceTemplateId;
        if (!uid || !itemId) {
          setSessionFavorited(false);
          return;
        }

        // attach a snapshot listener for this user's favorites so UI stays in sync across tabs
        const { onSnapshot } = await import('firebase/firestore');
        unsubscribe = onSnapshot(collection(db, 'users', uid, 'favorites'), (snap) => {
          try {
            const favSet = new Set<string>();
            snap.docs.forEach(d => {
              const data = d.data() as any;
              favSet.add(`${data.itemType||'routine'}::${data.itemId}`);
            });
            // write to shared cache
            (window as any).__app_favorites_cache.map = favSet;
            const favId = `routine::${itemId}`;
            if (mounted) setSessionFavorited(favSet.has(favId));
          } catch (e) { console.warn('favorites snapshot handling failed', e); }
        });
      } catch (e) {
        console.warn('Failed to load session favorite', e);
      }
    };

    void initFav();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [session.sourceTemplateId]);

  useEffect(() => {
    // keep session.durationSec in sync while editing
    // Guard so we don't overwrite the session when parent intentionally resets it
    const currentDuration = session.durationSec || 0;
    if (timerSec !== currentDuration) {
      setSession({ ...session, durationSec: timerSec });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerSec]);

  // If the parent resets the session (or its duration changes externally),
  // make sure the local timerSec follows the incoming session prop instead
  // of persisting the old timer value back into the parent.
  useEffect(() => {
    const incoming = session.durationSec || 0;
    if (timerSec !== incoming) {
      setTimerSec(incoming);
    }
    // only react to changes in the session's duration or identity-ish fields
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.durationSec, session.dateISO, session.completed]);

  // timer formatting handled inline where needed; removed helper to avoid unused warning

  const resetTimer = () => {
    setTimerRunning(false);
    setTimerSec(0);
  };
  const totalStats = useMemo(() => {
    const totalExercises = session.exercises.length;
    const totalSets = session.exercises.reduce((a, e) => a + e.sets.length, 0);
    const totalReps = session.exercises.reduce((a, e) => a + e.sets.reduce((x, y) => x + (y || 0), 0), 0);
    return { totalExercises, totalSets, totalReps };
  }, [session.exercises]);
  const completedExercises = useMemo(
    () => session.exercises.filter((exercise) => getExerciseProgress(exercise).goalMet).length,
    [session.exercises]
  );
  const completionPercent = totalStats.totalExercises > 0
    ? Math.round((completedExercises / totalStats.totalExercises) * 100)
    : 0;
  const sessionTypesLabel = session.sessionTypes.length > 0 ? session.sessionTypes.join(", ") : "Uncategorized";
  const nextFocusExercise = session.exercises.find((exercise) => !getExerciseProgress(exercise).goalMet);
  const nextFocusLabel = nextFocusExercise?.name?.trim() || session.exercises[0]?.name?.trim() || "Add an exercise";
  const formattedSessionDate = new Date(session.dateISO + "T00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const addExercise = () => {
    setSession({
      ...session,
      exercises: [
        ...session.exercises,
        { id: crypto.randomUUID(), name: "", minSets: 3, targetReps: 6, intensity: 0, sets: [0, 0, 0], notes: "" },
      ],
    });
  };

  const deleteExercise = (id: string) => {
    setSession({ ...session, exercises: session.exercises.filter((e) => e.id !== id) });
  };

  const updateExercise = (id: string, patch: Partial<ResistanceExercise>) => {
    setSession({
      ...session,
      exercises: session.exercises.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  };

  const updateSet = (id: string, setIndex: number, value: number) => {
    setSession({
      ...session,
      exercises: session.exercises.map((e) => {
        if (e.id !== id) return e;
        const sets = [...e.sets];
        sets[setIndex] = value;
        return { ...e, sets };
      }),
    });
  };

  const addSet = (id: string) => {
    setSession({
      ...session,
      exercises: session.exercises.map((e) => (e.id === id ? { ...e, sets: [...e.sets, 0] } : e)),
    });
  };

  const removeSet = (id: string, setIndex: number) => {
    setSession({
      ...session,
      exercises: session.exercises.map((e) => {
        if (e.id !== id) return e;
        const sets = e.sets.filter((_, i) => i !== setIndex);
        return { ...e, sets };
      }),
    });
  };

  const completeWorkout = async () => {
    // Prevent double-processing for the same session object
    if (completedGuards.has(session)) {
      console.warn('[WT] completeWorkout called but session already processed', { sessionName: session.sessionName, dateISO: session.dateISO });
      return;
    }
    completedGuards.add(session);

    // Mark session as completed in local state
    setSession({ ...session, completed: true, durationSec: timerSec });

    // Play celebration sound for workout completion
    playWorkoutCompletionSound();

    const today = session.dateISO;
    const todayIndex = weekly.days.findIndex((d) => d.dateISO === today);

    // Persist completed session to Firestore first so we get a document id
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        console.warn('[WT] completeWorkout: no user id, cannot persist session');
      } else {
        const payload = { ...session, completed: true, durationSec: timerSec, completedAt: Date.now() };
        const docRef = await addDoc(collection(db, 'users', uid, 'sessions'), payload as any);
        const sessionId = docRef.id;

        if (todayIndex !== -1) {
          const updatedDays = [...weekly.days];
          const markTypes: string[] = [...session.sessionTypes];
          // if Bike is present, also mark Cardio implicitly
          if (markTypes.includes('Bike') && !markTypes.includes('Cardio')) markTypes.push('Cardio');
          const newTypes = { ...updatedDays[todayIndex].types } as Record<string, boolean>;
          markTypes.forEach((t) => { newTypes[t] = true; });
          // push a session record (with id) into sessionsList (authoritative list of sessions)
          const oldList = Array.isArray(updatedDays[todayIndex].sessionsList) ? updatedDays[todayIndex].sessionsList.slice() : [];
          oldList.push({ id: sessionId, sessionTypes: markTypes });
          const after = { ...newTypes, sessions: oldList.length };
          updatedDays[todayIndex] = { ...updatedDays[todayIndex], types: newTypes, sessions: after.sessions, sessionsList: oldList };
          const newWeekly = { ...weekly, days: updatedDays } as WeeklyPlan;
          setWeekly(newWeekly);
          // Persist weekly immediately so sessionsList is saved server-side
          try {
            await setDoc(doc(db, 'users', uid, 'state', newWeekly.weekOfISO), { weekly: newWeekly }, { merge: true });
          } catch (e) {
            console.error('[WT] failed to persist weekly after completeWorkout', e);
          }
        } else {
          console.warn('[WT] completeWorkout: todayIndex not found in weekly.days', { today, weeklyDays: weekly.days.map((d) => d.dateISO) });
        }
      }
    } catch (e) {
      console.error('Failed to save completed session', e);
    }
    // stop the timer when completed
    setTimerRunning(false);
    setTimerSec(0);

    // Clear the current workout session to make space for a new one
    // The completed workout is now saved in history and remains editable there
    setTimeout(() => {
      setSession(defaultSession());
      toasts.push('Workout completed. Starting a fresh workout session.', 'success');
    }, 1500); // Small delay to let user see the completion state

    // leave the guard true to prevent re-entry
  };

  const loadRoutines = async () => {
    // show modal selection — load routines into local state for modal
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        const items = loadLocalRoutines();
  if (!items || items.length === 0) { toasts.push('No local routines saved', 'info'); return; }
        setRoutines(items);
        setShowLoadModal(true);
        return;
      }
      const ref = collection(db, 'users', uid, 'routines');
      const snaps = await getDocs(ref);
      const items = snaps.docs.map((s) => ({ id: s.id, ...(s.data() as any) }));
  if (items.length === 0) { toasts.push('No routines saved', 'info'); return; }
      setRoutines(items);
      setShowLoadModal(true);
    } catch (e) {
      console.error('Load routines failed', e);
  toasts.push('Load failed', 'error');
    }
  };

  // Show save dialog - first step
  const saveRoutine = async () => {

    // Validation checks
    if (!session.exercises || session.exercises.length === 0) {
      console.warn('[SaveRoutine] No exercises to save');
      toasts.push('Add exercises before saving routine', 'error');
      return;
    }

    // Set default name and show dialog
    const defaultName = session.sessionName?.trim() || 'My Routine';
    setRoutineName(defaultName);
    setSaveDialogOpen(true);
  };

  // Actually save the routine - second step after user confirms name
  const confirmSaveRoutine = async () => {
    if (!routineName.trim()) {
      toasts.push('Please enter a routine name', 'error');
      return;
    }

    setIsSaving(true);

    try {
      const uid = auth.currentUser?.uid;

      const payload = {
        id: crypto.randomUUID(),
        name: routineName.trim(),
        exercises: session.exercises.map((e) => ({
          id: e.id,
          name: e.name,
          minSets: e.minSets,
          targetReps: e.targetReps
        })),
        sessionTypes: session.sessionTypes,
        createdAt: Date.now(),
        public: false,
        owner: uid,
        ownerName: userName || 'User'
      };


      if (!uid) {
        saveLocalRoutine(payload);
        toasts.push(`Routine "${routineName}" saved locally!`, 'success');
      } else {
        const ref = collection(db, 'users', uid, 'routines');
        await addDoc(ref, payload as any);
        toasts.push(`Routine "${routineName}" saved to library!`, 'success');
      }

      // Close dialog and reset
      setSaveDialogOpen(false);
      setRoutineName("");
    } catch (e) {
      console.error('[SaveRoutine] Save routine failed:', e);
      toasts.push(`Save failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSessionFavorite = async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return toasts.push('Sign in to favorite', 'info');

      const itemId = session.sourceTemplateId;
      const itemType = itemId ? 'routine' : null;

      if (itemId) {
        const favId = `${itemType}::${itemId}`;
        if (pendingFavorites.has(favId)) return;

        setPendingFavorites((prev) => new Set(prev).add(favId));
        setSessionFavorited((current) => !current);

        try {
          const favRef = doc(db, 'users', uid, 'favorites', favId);
          const favSnap = await getDoc(favRef);
          if (favSnap.exists()) {
            await deleteDoc(favRef);
            toasts.push('Removed favorite', 'success');
          } else {
            await setDoc(favRef, { itemType, itemId, createdAt: Date.now() });
            toasts.push('Favorited', 'success');
          }
        } catch (error) {
          console.error('Favorite current session failed', error);
          setSessionFavorited((current) => !current);
          toasts.push('Failed', 'error');
        } finally {
          setPendingFavorites((prev) => {
            const next = new Set(prev);
            next.delete(favId);
            return next;
          });
        }
        return;
      }

      const payload = {
        name: session.sessionName || 'Routine',
        exercises: session.exercises.map((exercise) => ({
          name: exercise.name,
          minSets: exercise.minSets,
          targetReps: exercise.targetReps,
        })),
        sessionTypes: session.sessionTypes || [],
        createdAt: Date.now(),
        public: false,
        owner: uid,
        ownerName: 'User',
      };

      const ref = collection(db, 'users', uid, 'routines');
      const docRef = await addDoc(ref, payload as any);
      const favId = `routine::${docRef.id}`;
      setPendingFavorites((prev) => new Set(prev).add(favId));

      try {
        await setDoc(doc(db, 'users', uid, 'favorites', favId), {
          itemType: 'routine',
          itemId: docRef.id,
          createdAt: Date.now(),
        });
        toasts.push('Saved routine and favorited', 'success');
      } catch (error) {
        console.error('Favorite current session failed', error);
        toasts.push('Failed', 'error');
      } finally {
        setPendingFavorites((prev) => {
          const next = new Set(prev);
          next.delete(favId);
          return next;
        });
      }
    } catch (error) {
      console.error('Favorite current session failed', error);
      toasts.push('Failed', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-0 bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.28),_transparent_38%),radial-gradient(circle_at_top_right,_rgba(196,181,253,0.22),_transparent_34%),linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#f8fafc_100%)] shadow-xl shadow-slate-200/70">
        <CardHeader className="gap-6 border-b border-white/70 bg-white/75 backdrop-blur-sm">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white">
                  Workout session
                </span>
                <span className="inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {sessionTypesLabel}
                </span>
                {session.sourceTemplateId ? (
                  <span className="inline-flex items-center rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700">
                    From library
                  </span>
                ) : null}
                {session.completed ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Completed
                  </span>
                ) : null}
              </div>

              <div className="space-y-3">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Session name</label>
                <Input
                  value={session.sessionName}
                  onChange={(e) => setSession({ ...session, sessionName: e.target.value })}
                  className="h-14 border-white/70 bg-white/90 text-2xl font-semibold tracking-tight shadow-sm"
                  placeholder="Workout name (e.g., Legs, Upper Body)"
                />
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 shadow-sm">
                    <CalendarDays className="h-4 w-4 text-slate-500" />
                    {formattedSessionDate}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 shadow-sm">
                    <ListChecks className="h-4 w-4 text-slate-500" />
                    Next focus: {nextFocusLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-[420px]">
              <div className="rounded-3xl bg-white/85 p-4 shadow-sm ring-1 ring-white/70">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Elapsed</div>
                <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{formatDuration(timerSec)}</div>
                <div className="mt-1 text-sm text-slate-500">{timerRunning ? "Timer running" : "Timer paused"}</div>
              </div>
              <div className="rounded-3xl bg-white/85 p-4 shadow-sm ring-1 ring-white/70">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Progress</div>
                <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                  {completedExercises}/{totalStats.totalExercises}
                </div>
                <div className="mt-1 text-sm text-slate-500">Exercises at goal</div>
              </div>
              <div className="rounded-3xl bg-white/85 p-4 shadow-sm ring-1 ring-white/70">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sets logged</div>
                <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{totalStats.totalSets}</div>
                <div className="mt-1 text-sm text-slate-500">Across the whole session</div>
              </div>
              <div className="rounded-3xl bg-white/85 p-4 shadow-sm ring-1 ring-white/70">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Total reps</div>
                <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{totalStats.totalReps}</div>
                <div className="mt-1 text-sm text-slate-500">Current volume</div>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4 pt-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="rounded-[2rem] bg-slate-950 p-6 text-white shadow-2xl shadow-slate-300/50">
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Live timer</div>
                <div className="mt-3 text-5xl font-semibold tracking-tight">{formatDuration(timerSec)}</div>
                <div className="mt-2 max-w-md text-sm text-slate-300">
                  Keep the timer and completion action together so the workout always has a single obvious control point.
                </div>
              </div>
              <div className="rounded-3xl bg-white/10 px-4 py-4 md:min-w-[180px]">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Session status</div>
                <div className="mt-2 text-2xl font-semibold">
                  {session.completed ? "Completed" : `${completionPercent}% ready`}
                </div>
                <div className="mt-1 text-sm text-slate-300">
                  {completedExercises} of {totalStats.totalExercises} exercises hit their target.
                </div>
              </div>
            </div>

            <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-400 transition-all" style={{ width: `${completionPercent}%` }} />
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {!timerRunning ? (
                <Button
                  onClick={() => setTimerRunning(true)}
                  className="bg-white text-slate-950 hover:bg-slate-100"
                >
                  <Play className="mr-2 h-4 w-4" />
                  Start timer
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  onClick={() => setTimerRunning(false)}
                  className="bg-rose-500 text-white hover:bg-rose-600"
                >
                  <Pause className="mr-2 h-4 w-4" />
                  Pause timer
                </Button>
              )}
              <Button
                variant="outline"
                onClick={resetTimer}
                className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset
              </Button>
              {!session.completed ? (
                <Button
                  onClick={completeWorkout}
                  className="bg-emerald-500 text-white hover:bg-emerald-600"
                >
                  <Check className="mr-2 h-4 w-4" />
                  Complete workout
                </Button>
              ) : (
                <div className="inline-flex items-center rounded-full bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-300">
                  <Check className="mr-2 h-4 w-4" />
                  Workout completed
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Session controls</div>
            <div className="mt-5 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Session date</label>
                <Input
                  type="date"
                  value={session.dateISO}
                  onChange={(e) => setSession({ ...session, dateISO: e.target.value })}
                  className="border-slate-200 bg-slate-50"
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" onClick={loadRoutines} className="justify-start border-slate-200 bg-white">
                  <Dumbbell className="mr-2 h-4 w-4" />
                  Load routine
                </Button>
                <Button
                  variant="secondary"
                  onClick={saveRoutine}
                  disabled={isSaving}
                  className="justify-start bg-slate-900 text-white hover:bg-slate-800"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {isSaving ? 'Saving...' : 'Save routine'}
                </Button>
                <Button
                  variant="outline"
                  onClick={toggleSessionFavorite}
                  title="Favorite this session"
                  disabled={!!(session.sourceTemplateId && pendingFavorites.has(`routine::${session.sourceTemplateId}`))}
                  className="justify-start border-slate-200 bg-white"
                >
                  <Bookmark className={cn('mr-2 h-4 w-4', sessionFavorited && 'fill-yellow-400 text-yellow-500')} />
                  {sessionFavorited ? 'Favorited' : 'Favorite session'}
                </Button>
                <Button onClick={addExercise} className="justify-start bg-sky-600 text-white hover:bg-sky-700">
                  <Plus className="mr-2 h-4 w-4" />
                  Add exercise
                </Button>
              </div>

              <div className="rounded-3xl bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Activity className="h-4 w-4 text-sky-600" />
                  Current focus
                </div>
                <div className="mt-2 text-base font-semibold text-slate-900">{nextFocusLabel}</div>
                <div className="mt-1 text-sm text-slate-600">
                  Keep moving down the list and use the exercise cards for reps, notes, and previous-session context.
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Exercises</h2>
          <p className="mt-1 text-sm text-slate-600">
            Each card keeps editing, progress, and history in one place so you do not need to bounce around the screen.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm ring-1 ring-slate-200">
          <TimerReset className="h-4 w-4 text-slate-400" />
          {completedExercises} complete of {totalStats.totalExercises}
        </div>
      </div>

      {session.exercises.length === 0 ? (
        <Card className="border-dashed border-sky-300 bg-sky-50/70">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="rounded-full bg-white p-4 shadow-sm">
              <Dumbbell className="h-7 w-7 text-sky-600" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-slate-900">No exercises yet</h3>
              <p className="text-sm text-slate-600">Add one manually or load a routine from your library.</p>
            </div>
            <Button onClick={addExercise} className="bg-sky-600 text-white hover:bg-sky-700">
              <Plus className="mr-2 h-4 w-4" />
              Add first exercise
            </Button>
          </CardContent>
        </Card>
      ) : (
        session.exercises.map((ex) => (
          <ExerciseCard
            key={ex.id}
            ex={ex}
            updateExercise={updateExercise}
            updateSet={updateSet}
            addSet={addSet}
            removeSet={removeSet}
            onDelete={() => deleteExercise(ex.id)}
          />
        ))
      )}

      <Card className="border border-slate-200 bg-white/90 shadow-sm">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Session footer</div>
            <div className="mt-1 text-sm text-slate-600">
              Timer: {formatDuration(timerSec)}. Volume: {totalStats.totalSets} sets and {totalStats.totalReps} reps.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={loadRoutines}>
              <Dumbbell className="mr-2 h-4 w-4" />
              Load routine
            </Button>
            <Button onClick={addExercise} className="bg-sky-600 text-white hover:bg-sky-700">
              <Plus className="mr-2 h-4 w-4" />
              Add exercise
            </Button>
            {!session.completed ? (
              <Button onClick={completeWorkout} className="bg-emerald-500 text-white hover:bg-emerald-600">
                <Check className="mr-2 h-4 w-4" />
                Complete workout
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Load routine modal */}
      {showLoadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl">
            <h3 className="text-lg font-semibold mb-4">Load a routine</h3>
            <div className="grid gap-2 max-h-72 overflow-y-auto">
              {routines.map((r) => (
                <div key={r.id} className={cn('p-3 rounded border', selectedRoutineId === r.id && 'bg-slate-50 border-slate-300')} onClick={() => setSelectedRoutineId(r.id)}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-neutral-600">{(r.exercises || []).length} exercises</div>
                    </div>
                    <div className="text-sm text-neutral-600">{(r.sessionTypes || []).join(', ')}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => { setShowLoadModal(false); setSelectedRoutineId(null); }}>Cancel</Button>
              <Button onClick={() => {
                const found = routines.find((x) => x.id === selectedRoutineId);
                if (!found) return toasts.push('Select a routine', 'info');
                const exercises = (found.exercises || []).map((e: any) => ({ id: crypto.randomUUID(), name: e.name, minSets: e.minSets, targetReps: e.targetReps, intensity: e.intensity || 0, sets: Array(e.minSets).fill(0), notes: e.notes || "" }));
                setSession({ ...session, sessionName: found.name, exercises, completed: false, sessionTypes: found.sessionTypes || [], durationSec: 0 });
                setShowLoadModal(false);
                setSelectedRoutineId(null);
              }}>Load selected</Button>
            </div>
          </div>
        </div>
      )}

      {/* Save Routine Dialog */}
      {saveDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Save Routine</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Routine Name
                </label>
                <Input
                  value={routineName}
                  onChange={(e) => setRoutineName(e.target.value)}
                  placeholder="Enter routine name..."
                  className="w-full"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && routineName.trim()) {
                      confirmSaveRoutine();
                    }
                  }}
                />
              </div>

              <div className="text-sm text-gray-500">
                This will save {session.exercises.length} exercises to your library.
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setSaveDialogOpen(false);
                  setRoutineName("");
                }}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmSaveRoutine}
                disabled={isSaving || !routineName.trim()}
              >
                {isSaving ? 'Saving...' : 'Save Routine'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
