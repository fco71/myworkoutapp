import { useMemo, useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc, collection, addDoc, getDocs, deleteDoc, getDoc } from "firebase/firestore";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Check, Save, Bookmark, ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
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
  const sum = ex.sets.reduce((a, b) => a + (b || 0), 0);
  const firstN = ex.sets.slice(0, ex.minSets);
  const allFirstNMeet = firstN.length >= ex.minSets && firstN.every((r) => r >= ex.targetReps);
  const totalTarget = ex.minSets * ex.targetReps;
  const goalMet = allFirstNMeet || sum >= totalTarget;

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

  return (
    <Card className={cn(
      "transition-all duration-300 hover:shadow-lg",
      goalMet ? "border-emerald-500 bg-gradient-to-br from-emerald-50 to-green-50 shadow-emerald-100" : "border-slate-200 bg-white shadow-slate-100"
    )}>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Exercise Name</label>
            <Input
              value={ex.name || ""}
              onChange={(e) => updateExercise(ex.id, { name: e.target.value })}
              placeholder="Enter exercise name (e.g., Push ups, Bodyweight Row)"
              className="max-w-xs min-w-[200px] border-2"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-neutral-600">Min sets</label>
            <Input
              type="number"
              className="w-20"
              value={ex.minSets}
              min={1}
              onChange={(e) => updateExercise(ex.id, { minSets: Math.max(1, parseInt(e.target.value || "1")) })}
            />
            <label className="text-neutral-600">Target reps</label>
            <Input
              type="number"
              className="w-20"
              value={ex.targetReps}
              min={1}
              onChange={(e) => updateExercise(ex.id, { targetReps: Math.max(1, parseInt(e.target.value || "1")) })}
            />
            <label className="text-neutral-600">Intensity</label>
            <Input
              type="number"
              className="w-20"
              value={ex.intensity || 0}
              min={0}
              max={999}
              placeholder="0"
              onChange={(e) => updateExercise(ex.id, { intensity: Math.max(0, Math.min(999, parseInt(e.target.value || "0"))) })}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="font-medium">Total: {sum} / {totalTarget}</div>
          <span className={cn("flex items-center gap-1", goalMet ? "text-green-700" : "invisible")}>
            <Check className="h-4 w-4"/> goal met
          </span>
          {confirmDelete ? (
            <>
              <span className="text-sm text-red-600 font-medium">Remove?</span>
              <Button variant="destructive" size="sm" onClick={onDelete}>Yes</Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>No</Button>
            </>
          ) : (
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="mr-2 h-4 w-4" /> Remove
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Current Sets Input */}
          <div className="flex flex-wrap gap-2 items-start">
            {ex.sets.map((rep, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    className={cn(
                      "w-20 text-center",
                      setOK(rep) && "bg-green-50 border-green-400 text-green-900"
                    )}
                    value={rep}
                    onChange={(e) => updateSet(ex.id, i, Math.max(0, parseInt(e.target.value || "0")))}
                  />
                  <Button variant="secondary" size="icon" onClick={() => removeSet(ex.id, i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {/* Previous session data directly below each input */}
                {lastWorkout && lastWorkout.sets && lastWorkout.sets[i] !== undefined && (
                  <div className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-200 min-w-[20px] text-center">
                    {lastWorkout.sets[i]}
                  </div>
                )}
              </div>
            ))}
            <Button onClick={() => addSet(ex.id)} className="mt-0">
              <Plus className="mr-2 h-4 w-4"/> Add set
            </Button>
          </div>

          {/* Last Session Reference Summary */}
          {lastWorkout && lastWorkout.sets && lastWorkout.sets.length > 0 && (
            <div className="text-xs text-blue-700 bg-blue-50 px-3 py-2 rounded border border-blue-200">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  Last: {lastWorkout.sessionDate.toLocaleDateString()}
                </span>
                <div className="flex items-center gap-2">
                  <span>Total: {lastWorkout.sets.reduce((sum: number, reps: number) => sum + reps, 0)}</span>
                  {lastWorkout.intensity && (
                    <span>Intensity: {lastWorkout.intensity}</span>
                  )}
                </div>
              </div>
              {lastWorkout.notes && (
                <div className="mt-1 text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                  <span className="font-medium">Notes:</span> {lastWorkout.notes}
                </div>
              )}
            </div>
          )}

          {/* Exercise Notes */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Notes</span>
            </div>
            <Input
              placeholder="Add notes about this exercise (form cues, weight used, etc.)"
              value={ex.notes || ''}
              onChange={(e) => updateExercise(ex.id, { notes: e.target.value })}
              className="text-sm"
            />
          </div>

          {/* Helper message for unnamed exercises */}
          {!ex.name.trim() || ex.name === 'New exercise' ? (
            <div className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded border border-amber-200">
              💡 Enter an exercise name above to see your previous performance
            </div>
          ) : null}
        </div>

        <div className="mt-3 text-xs text-neutral-600">
          Rule: individual set turns green when it ≥ target reps. Main card turns green when either the first <strong>min sets</strong> all meet target, or the <strong>sum of reps</strong> across all sets ≥ <em>min sets × target reps</em>.
        </div>

        {/* Expandable Exercise History */}
        {hasHistory && (recentWorkouts && recentWorkouts.length > 1 || personalRecord) && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div
              className="flex items-center justify-between cursor-pointer hover:bg-slate-50 p-2 rounded transition-colors"
              onClick={() => setHistoryExpanded(!historyExpanded)}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">More History</span>
                {recentWorkouts && recentWorkouts.length > 1 && (
                  <span className="text-xs text-gray-500">({recentWorkouts.length - 1} previous sessions)</span>
                )}
                {historyLoading && <span className="text-xs text-gray-500">Loading...</span>}
              </div>
              {historyExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>

            {historyExpanded && !historyLoading && (
              <div className="mt-3 space-y-3">
                {/* Personal Record */}
                {personalRecord && personalRecord !== lastWorkout && (
                  <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-3">
                    <h4 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                      Personal Record ({personalRecord.sessionDate.toLocaleDateString()})
                    </h4>
                    <div className="flex gap-2 flex-wrap items-center">
                      {(personalRecord.sets || []).map((reps: number, i: number) => (
                        <div key={i} className="bg-amber-100 text-amber-800 px-2 py-1 rounded text-sm font-medium">
                          {reps}
                        </div>
                      ))}
                      <span className="text-xs text-amber-600 ml-2">
                        Total: {(personalRecord.sets || []).reduce((sum: number, reps: number) => sum + reps, 0)} reps
                      </span>
                      {personalRecord.intensity && (
                        <span className="text-xs text-amber-600">I:{personalRecord.intensity}</span>
                      )}
                    </div>
                    {personalRecord.notes && (
                      <div className="mt-2 text-xs text-amber-700 bg-amber-100 px-2 py-1 rounded">
                        <span className="font-medium">Notes:</span> {personalRecord.notes}
                      </div>
                    )}
                  </div>
                )}

                {/* Previous Sessions History */}
                {recentWorkouts && recentWorkouts.length > 1 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-gray-500 rounded-full"></span>
                      Previous Sessions
                    </h4>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {recentWorkouts.slice(1).map((workout: any, i: number) => (
                        <div key={`${workout.sessionId}-${i}`} className="text-sm py-1">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600 font-medium">
                              {workout.sessionDate.toLocaleDateString()}
                            </span>
                            <div className="flex gap-1 items-center">
                              {(workout.sets || []).map((reps: number, j: number) => (
                                <span key={j} className="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded text-xs font-medium">
                                  {reps}
                                </span>
                              ))}
                              {workout.intensity && (
                                <span className="text-gray-500 text-xs ml-1">I:{workout.intensity}</span>
                              )}
                              <span className="text-gray-500 text-xs ml-2">
                                ({(workout.sets || []).reduce((sum: number, reps: number) => sum + reps, 0)} total)
                              </span>
                            </div>
                          </div>
                          {workout.notes && (
                            <div className="mt-1 text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                              <span className="font-medium">Notes:</span> {workout.notes}
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
    const initFav = async () => {
      try {
        const uid = auth.currentUser?.uid;
        const itemId = session.sourceTemplateId;
        if (!uid || !itemId) return;
        // attach a snapshot listener for this user's favorites so UI stays in sync across tabs
        const unsub = (await import('firebase/firestore')).onSnapshot(collection(db, 'users', uid, 'favorites'), (snap) => {
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
        return () => unsub && unsub();
      } catch (e) {
        console.warn('Failed to load session favorite', e);
      }
    };
    // call initFav
    (async () => { await initFav(); })();
    return () => { mounted = false; };
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
      toasts.push('🎉 Workout completed! Starting fresh workout session.', 'success');
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Card className="w-full bg-gradient-to-r from-slate-50 to-blue-50">
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Input
                  value={session.sessionName}
                  onChange={(e) => setSession({ ...session, sessionName: e.target.value })}
                  className="text-xl font-bold border-0 bg-transparent p-0"
                  placeholder="Workout name (e.g., Legs, Upper Body)"
                />
                <p className="text-sm text-slate-600 mt-1">
                    {new Date(session.dateISO + 'T00:00').toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {/* Removed inline timer display — main timer remains below as requested */}
                <div className="flex gap-2">
                  {!timerRunning ? (
                    <Button onClick={() => setTimerRunning(true)}>Start</Button>
                  ) : (
                    <Button variant="destructive" onClick={() => setTimerRunning(false)}>Pause</Button>
                  )}
                  <Button variant="outline" onClick={resetTimer}>Reset</Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={session.dateISO}
                  onChange={(e) => setSession({ ...session, dateISO: e.target.value })}
                  className="w-auto"
                />
                  <Button variant="outline" onClick={async ()=>{
                    try {
                      const uid = auth.currentUser?.uid; if (!uid) return toasts.push('Sign in to favorite', 'info');
                      const itemId = session.sourceTemplateId;
                      const itemType = itemId ? 'routine' : null;
                      if (itemId) {
                        // prevent rapid toggles by tracking pending favs
                        const favId = `${itemType}::${itemId}`;
                        if (pendingFavorites.has(favId)) return; // noop while pending
                        setPendingFavorites(prev => new Set(prev).add(favId));
                        // optimistic UI
                        setSessionFavorited((s) => !s);
                        try {
                          const favRef = doc(db, 'users', uid, 'favorites', favId);
                          const favSnap = await getDoc(favRef);
                          if (favSnap.exists()) { await deleteDoc(favRef); toasts.push('Removed favorite', 'success'); }
                          else { await setDoc(favRef, { itemType, itemId, createdAt: Date.now() }); toasts.push('Favorited', 'success'); }
                        } catch (e) {
                          console.error('Favorite current session failed', e);
                          // rollback
                          setSessionFavorited((s) => !s);
                          toasts.push('Failed', 'error');
                        } finally {
                          setPendingFavorites(prev => { const n = new Set(prev); n.delete(favId); return n; });
                        }
                        return;
                      }
                      // no template id: save current session as routine and favorite it
                      const payload = { name: session.sessionName || 'Routine', exercises: session.exercises.map(e=>({ name: e.name, minSets: e.minSets, targetReps: e.targetReps })), sessionTypes: session.sessionTypes || [], createdAt: Date.now(), public: false, owner: uid, ownerName: 'User' };
                      const ref = collection(db, 'users', uid, 'routines');
                      const docRef = await addDoc(ref, payload as any);
                      const favId = `routine::${docRef.id}`;
                      setPendingFavorites(prev => new Set(prev).add(favId));
                      try {
                        await setDoc(doc(db, 'users', uid, 'favorites', favId), { itemType: 'routine', itemId: docRef.id, createdAt: Date.now() });
                        toasts.push('Saved routine and favorited', 'success');
                      } catch (e) {
                        console.error('Favorite current session failed', e);
                        toasts.push('Failed', 'error');
                      } finally { setPendingFavorites(prev => { const n = new Set(prev); n.delete(favId); return n; }); }
                    } catch (e) { console.error('Favorite current session failed', e); toasts.push('Failed', 'error'); }
                  }} title="Favorite this session" disabled={!!(session.sourceTemplateId && pendingFavorites.has(`routine::${session.sourceTemplateId}`))}>
                    <Bookmark className={cn('h-4 w-4', sessionFavorited && 'text-yellow-500')} />
                  </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
              <div><strong>Exercises:</strong> {totalStats.totalExercises}</div>
              <div>• <strong>Sets:</strong> {totalStats.totalSets}</div>
              <div>• <strong>Total reps:</strong> {totalStats.totalReps}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {session.exercises.map((ex) => (
        <ExerciseCard
          key={ex.id}
          ex={ex}
          updateExercise={updateExercise}
          updateSet={updateSet}
          addSet={addSet}
          removeSet={removeSet}
          onDelete={() => deleteExercise(ex.id)}
        />
      ))}

      <div className="flex gap-2">
        <Button onClick={addExercise}>
          <Plus className="mr-2 h-4 w-4" /> Add exercise
        </Button>
        <Button variant="outline" onClick={loadRoutines}>
          Load Routine
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            saveRoutine();
          }}
          disabled={isSaving}
        >
          <Save className="mr-2 h-4 w-4"/>
          {isSaving ? 'Saving...' : 'Save Routine'}
        </Button>
        {/* 'New session' removed for Lifestyle Tracker flow */}
        {!session.completed && (
          <Button
            onClick={completeWorkout}
            className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white"
          >
            <Check className="mr-2 h-4 w-4" /> Complete Workout
          </Button>
        )}
        {session.completed && (
          <div className="flex items-center gap-2 text-green-600 font-semibold">
            <Check className="h-4 w-4" />
            Workout Completed!
          </div>
        )}
      </div>
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
