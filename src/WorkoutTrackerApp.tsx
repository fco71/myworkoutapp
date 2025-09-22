import React, { useMemo, useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Check, RefreshCw, Save } from "lucide-react";

// --- Types ---
type WorkoutType = "Bike" | "Calves" | "Resistance" | "Cardio" | "Mobility" | "Other";

type WeeklyDay = {
  dateISO: string; // yyyy-mm-dd
  types: Partial<Record<WorkoutType, boolean>>; // did I do this type today?
};

type WeeklyPlan = {
  weekOfISO: string; // Monday of week
  weekNumber: number; // Training week number
  days: WeeklyDay[]; // 7 days
  benchmarks: Partial<Record<WorkoutType, number>>; // target days per type
  customTypes: WorkoutType[]; // User's custom workout types
};

type ResistanceExercise = {
  id: string;
  name: string;
  minSets: number; // usually 3
  targetReps: number; // e.g., 6
  sets: number[]; // reps per set, editable
};

type ResistanceSession = {
  dateISO: string;
  sessionName: string; // e.g., "Legs", "Upper Body"
  exercises: ResistanceExercise[];
  completed: boolean;
};

// --- Utilities ---
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function getMonday(d = new Date()) {
  const nd = new Date(d);
  const day = nd.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  nd.setDate(nd.getDate() + diff);
  nd.setHours(0, 0, 0, 0);
  return nd;
}

function weekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// --- Persistence (Firebase Firestore) ---
type PersistedState = { weekly: WeeklyPlan; session: ResistanceSession };

// --- Seed Defaults ---
function defaultWeekly(): WeeklyPlan {
  const monday = getMonday();
  const days = weekDates(monday).map((d) => ({
    dateISO: toISO(d),
    types: {},
  }));
  return {
    weekOfISO: toISO(monday),
    weekNumber: 1,
    days,
    benchmarks: { Bike: 3, Calves: 2, Resistance: 3, Cardio: 2, Mobility: 2, Other: 1 },
    customTypes: ["Bike", "Calves", "Resistance"],
  };
}

function defaultSession(): ResistanceSession {
  return {
    dateISO: toISO(new Date()),
    sessionName: "Workout",
    exercises: [
      { id: crypto.randomUUID(), name: "Pull-ups", minSets: 3, targetReps: 6, sets: [0, 0, 0] },
      { id: crypto.randomUUID(), name: "Push-ups", minSets: 3, targetReps: 12, sets: [0, 0, 0] },
    ],
    completed: false,
  };
}

// --- Weekly Overview Component ---
function WeeklyOverview({ weekly }: { weekly: WeeklyPlan }) {
  const today = new Date().toISOString().split('T')[0];
  const todayData = weekly.days.find(d => d.dateISO === today);
  
  const counts = useMemo(() => {
    const c: Record<WorkoutType, number> = {
      Bike: 0,
      Calves: 0,
      Resistance: 0,
      Cardio: 0,
      Mobility: 0,
      Other: 0,
    };
    weekly.days.forEach((d) => {
      Object.keys(d.types).forEach((t) => {
        if (d.types[t as WorkoutType]) c[t as WorkoutType] += 1;
      });
    });
    return c;
  }, [weekly.days]);

  const totalToday = todayData ? Object.values(todayData.types).filter(Boolean).length : 0;
  const weekProgress = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4 mb-8">
      {/* Week Number */}
      <div className="flex items-center justify-between">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg shadow-lg">
          <h2 className="text-2xl font-bold">Training Week {weekly.weekNumber}</h2>
          <p className="text-blue-100 text-sm">Keep pushing your limits!</p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => {
            // Reset week number - this would need to be passed as a prop
            console.log("Reset week number");
          }}
          className="bg-white/80 hover:bg-white"
        >
          Reset Week
        </Button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Today's Progress */}
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm font-medium">Today</p>
                <p className="text-3xl font-bold">{totalToday}</p>
                <p className="text-blue-200 text-xs">workouts completed</p>
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
              <p className="text-3xl font-bold">{weekProgress}</p>
              <p className="text-indigo-200 text-xs">total sessions</p>
            </div>
            <div className="w-12 h-12 bg-indigo-400 rounded-full flex items-center justify-center">
              <span className="text-2xl">📊</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resistance Progress */}
      <Card className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white border-0 shadow-lg">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-emerald-100 text-sm font-medium">Resistance</p>
              <p className="text-3xl font-bold">{counts.Resistance}</p>
              <p className="text-emerald-200 text-xs">sessions this week</p>
            </div>
            <div className="w-12 h-12 bg-emerald-400 rounded-full flex items-center justify-center">
              <span className="text-2xl">💪</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cardio Progress */}
      <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white border-0 shadow-lg">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-100 text-sm font-medium">Cardio</p>
              <p className="text-3xl font-bold">{counts.Cardio}</p>
              <p className="text-orange-200 text-xs">sessions this week</p>
            </div>
            <div className="w-12 h-12 bg-orange-400 rounded-full flex items-center justify-center">
              <span className="text-2xl">🏃</span>
            </div>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

// --- Components ---
export default function WorkoutTrackerApp() {
  const [weekly, setWeekly] = useState<WeeklyPlan>(defaultWeekly());
  const [session, setSession] = useState<ResistanceSession>(defaultSession());
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [booted, setBooted] = useState(false);

  // Offline cache is configured at Firestore initialization in lib/firebase

  // Auth + initial load
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (u) {
          setUserId(u.uid);
          setUserName(u.displayName || u.email || null);
          const ref = doc(db, "users", u.uid, "state", "tracker");
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const data = snap.data() as PersistedState;
            if (data?.weekly) setWeekly(data.weekly);
            if (data?.session) setSession(data.session);
          }
        } else {
          setUserId(null);
          setUserName(null);
        }
      } finally {
        setBooted(true);
      }
    });
    return () => unsub();
  }, []);

  // autosave to Firestore
  useEffect(() => {
    if (!userId) return;
    const ref = doc(db, "users", userId, "state", "tracker");
    const payload: PersistedState = { weekly, session };
    setDoc(ref, payload, { merge: true }).catch(() => {});
  }, [userId, weekly, session]);

  const resetWeek = () => setWeekly(defaultWeekly());
  const resetSession = () => setSession(defaultSession());

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 text-slate-900 p-6">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Workout Tracker
              </h1>
              <p className="text-slate-600 mt-2">Track your fitness journey with precision</p>
            </div>
            <div className="flex gap-2">
              {userId ? (
                <>
                  <span className="text-sm text-slate-600 hidden sm:inline">{userName || "Signed in"}</span>
                  <Button variant="secondary" onClick={() => signOut(auth)}>
                    Sign out
                  </Button>
                </>
              ) : (
                <Button variant="secondary" onClick={() => setShowSignIn(true)}>
                  Sign in
                </Button>
              )}
            </div>
          </div>
          
          {/* Weekly Overview Dashboard */}
          <WeeklyOverview weekly={weekly} />
        </header>

        <Tabs defaultValue="week" className="">
          <TabsList className="grid grid-cols-2 w-full md:w-auto bg-white/80 backdrop-blur-sm border border-slate-200 shadow-sm">
            <TabsTrigger value="week" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">Weekly Tracker</TabsTrigger>
            <TabsTrigger value="workout" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">Workout Session</TabsTrigger>
          </TabsList>

          <TabsContent value="week" className="mt-4">
            <WeeklyTracker weekly={weekly} setWeekly={setWeekly} onReset={resetWeek} />
          </TabsContent>

          <TabsContent value="workout" className="mt-4">
            <WorkoutView session={session} setSession={setSession} onReset={resetSession} weekly={weekly} setWeekly={setWeekly} />
          </TabsContent>
        </Tabs>
      </div>
      {showSignIn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>{isSignUp ? "Sign up" : "Sign in"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={async () => {
                    try {
                      if (isSignUp) {
                        await createUserWithEmailAndPassword(auth, email, password);
                      } else {
                        await signInWithEmailAndPassword(auth, email, password);
                      }
                      setShowSignIn(false);
                      setEmail("");
                      setPassword("");
                      setIsSignUp(false);
                    } catch (e) {
                      console.error("Auth failed:", e);
                    }
                  }}
                >
                  {isSignUp ? "Sign up" : "Sign in"}
                </Button>
                <Button variant="outline" onClick={() => setShowSignIn(false)}>
                  Cancel
                </Button>
              </div>
              <div className="text-center">
                <button
                  className="text-sm text-blue-600 hover:underline"
                  onClick={() => setIsSignUp(!isSignUp)}
                >
                  {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// --- Weekly Tracker ---
function WeeklyTracker({
  weekly,
  setWeekly,
  onReset,
}: {
  weekly: WeeklyPlan;
  setWeekly: (w: WeeklyPlan) => void;
  onReset: () => void;
}) {
  const types = weekly.customTypes;

  const counts = useMemo(() => {
    const c: Record<WorkoutType, number> = {
      Bike: 0,
      Calves: 0,
      Resistance: 0,
      Cardio: 0,
      Mobility: 0,
      Other: 0,
    };
    weekly.days.forEach((d) => {
      types.forEach((t) => {
        if (d.types[t]) c[t] += 1;
      });
    });
    return c;
  }, [weekly.days, types]);

  const monday = new Date(weekly.weekOfISO);
  const prettyRange = `${monday.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${
    new Date(weekDates(monday)[6]).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }`;

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-slate-200 shadow-lg">
      <CardHeader className="flex items-center justify-between bg-gradient-to-r from-slate-50 to-blue-50">
        <div>
          <CardTitle className="text-2xl font-bold text-slate-800">Week of {prettyRange}</CardTitle>
          <p className="text-sm text-slate-600">Click cells to toggle what you did each day.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => onReset()} className="bg-white hover:bg-slate-50">
            <RefreshCw className="mr-2 h-4 w-4" /> New Week
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white text-left p-2 border-b">Type</th>
                {weekly.days.map((d) => (
                  <th key={d.dateISO} className="p-2 text-xs font-medium border-b">
                    {new Date(d.dateISO).toLocaleDateString(undefined, { weekday: "short" })}
                    <div className="text-[10px] text-neutral-500">{new Date(d.dateISO).getDate()}</div>
                  </th>
                ))}
                <th className="p-2 text-left border-b">Total</th>
                <th className="p-2 text-left border-b">Benchmark</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => {
                const hit = counts[t] >= (weekly.benchmarks[t] ?? 0);
                return (
                  <tr key={t} className="">
                    <td className="sticky left-0 bg-white p-2 font-medium border-b">{t}</td>
                    {weekly.days.map((d, idx) => {
                      const active = !!d.types[t];
                      return (
                        <td
                          key={`${d.dateISO}-${t}`}
                          className={cn(
                            "p-2 text-center align-middle border-b cursor-pointer",
                            active && "bg-green-100/70"
                          )}
                          onClick={() => {
                            const days = [...weekly.days];
                            const day = { ...days[idx] };
                            day.types = { ...day.types, [t]: !active };
                            days[idx] = day;
                            setWeekly({ ...weekly, days });
                          }}
                        >
                          {active ? <Check className="inline h-4 w-4" /> : ""}
                        </td>
                      );
                    })}
                    <td className="p-2 border-b font-semibold">{counts[t]}</td>
                    <td className="p-2 border-b">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          className={cn(
                            "w-20",
                            hit && "bg-green-50 border-green-400 text-green-900"
                          )}
                          value={weekly.benchmarks[t] ?? 0}
                          onChange={(e) => {
                            const v = parseInt(e.target.value || "0");
                            setWeekly({
                              ...weekly,
                              benchmarks: { ...weekly.benchmarks, [t]: v },
                            });
                          }}
                        />
                        {hit && (
                          <span className="text-green-700 text-xs flex items-center gap-1">
                            <Check className="h-4 w-4" /> goal met
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Workout Session ---
function WorkoutView({
  session,
  setSession,
  onReset,
  weekly,
  setWeekly,
}: {
  session: ResistanceSession;
  setSession: (s: ResistanceSession) => void;
  onReset: () => void;
  weekly: WeeklyPlan;
  setWeekly: (w: WeeklyPlan) => void;
}) {
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
        { id: crypto.randomUUID(), name: "New exercise", minSets: 3, targetReps: 6, sets: [0, 0, 0] },
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

  const completeWorkout = () => {
    // Mark session as completed
    setSession({ ...session, completed: true });
    
    // Auto-populate weekly tracker
    const today = session.dateISO;
    const todayIndex = weekly.days.findIndex(d => d.dateISO === today);
    if (todayIndex !== -1) {
      const updatedDays = [...weekly.days];
      updatedDays[todayIndex] = {
        ...updatedDays[todayIndex],
        types: {
          ...updatedDays[todayIndex].types,
          Resistance: true
        }
      };
      setWeekly({ ...weekly, days: updatedDays });
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
                  {new Date(session.dateISO).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={session.dateISO}
                  onChange={(e) => setSession({ ...session, dateISO: e.target.value })}
                  className="w-auto"
                />
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
        <Button variant="secondary" onClick={onReset}>
          <RefreshCw className="mr-2 h-4 w-4" /> New session
        </Button>
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
    </div>
  );
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
  const setOK = (rep: number) => rep >= ex.targetReps;
  const sum = ex.sets.reduce((a, b) => a + (b || 0), 0);
  const firstN = ex.sets.slice(0, ex.minSets);
  const allFirstNMeet = firstN.length >= ex.minSets && firstN.every((r) => r >= ex.targetReps);
  const totalTarget = ex.minSets * ex.targetReps;
  const goalMet = allFirstNMeet || sum >= totalTarget;

  // Exercise history - empty by default, populated from Firestore when available
  const lastWorkout: number[] = []; // Will be populated from Firestore
  const personalRecord: number[] = []; // Will be populated from Firestore

  return (
    <Card className={cn(
      "transition-all duration-300 hover:shadow-lg",
      goalMet ? "border-emerald-500 bg-gradient-to-br from-emerald-50 to-green-50 shadow-emerald-100" : "border-slate-200 bg-white shadow-slate-100"
    )}>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Input
            value={ex.name}
            onChange={(e) => updateExercise(ex.id, { name: e.target.value })}
            className="max-w-xs"
          />
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
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="font-medium">Total: {sum} / {totalTarget}</div>
          {goalMet && (
            <span className="text-green-700 flex items-center gap-1"><Check className="h-4 w-4"/> goal met</span>
          )}
          <Button variant="destructive" onClick={onDelete}>
            <Trash2 className="mr-2 h-4 w-4" /> Remove
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 items-center">
          {ex.sets.map((rep, i) => (
            <div key={i} className="flex items-center gap-1">
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
          ))}
          <Button onClick={() => addSet(ex.id)}>
            <Plus className="mr-2 h-4 w-4"/> Add set
          </Button>
        </div>
        <div className="mt-3 text-xs text-neutral-600">
          Rule: individual set turns green when it ≥ target reps. Main card turns green when either the first <strong>min sets</strong> all meet target, or the <strong>sum of reps</strong> across all sets ≥ <em>min sets × target reps</em>.
        </div>
        
        {/* Exercise History - Only show if there's data */}
        {(lastWorkout.length > 0 || personalRecord.length > 0) && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Last Workout */}
              {lastWorkout.length > 0 && (
                <div className="bg-slate-50 rounded-lg p-3">
                  <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                    Last Workout
                  </h4>
                  <div className="flex gap-2 flex-wrap">
                    {lastWorkout.map((reps, i) => (
                      <div key={i} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm font-medium">
                        {reps}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Personal Record */}
              {personalRecord.length > 0 && (
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg p-3">
                  <h4 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                    Personal Record
                  </h4>
                  <div className="flex gap-2 flex-wrap">
                    {personalRecord.map((reps, i) => (
                      <div key={i} className="bg-amber-100 text-amber-800 px-2 py-1 rounded text-sm font-medium">
                        {reps}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
