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
type WorkoutType = "Resistance" | "Cardio" | "Mobility" | "Other";

type WeeklyDay = {
  dateISO: string; // yyyy-mm-dd
  types: Partial<Record<WorkoutType, boolean>>; // did I do this type today?
};

type WeeklyPlan = {
  weekOfISO: string; // Monday of week
  days: WeeklyDay[]; // 7 days
  benchmarks: Partial<Record<WorkoutType, number>>; // target days per type
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
  exercises: ResistanceExercise[];
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
    days,
    benchmarks: { Resistance: 3, Cardio: 3, Mobility: 2, Other: 1 },
  };
}

function defaultSession(): ResistanceSession {
  return {
    dateISO: toISO(new Date()),
    exercises: [
      { id: crypto.randomUUID(), name: "Pull-ups", minSets: 3, targetReps: 6, sets: [0, 0, 0] },
      { id: crypto.randomUUID(), name: "Push-ups", minSets: 3, targetReps: 12, sets: [0, 0, 0] },
    ],
  };
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
    <div className="min-h-screen bg-neutral-50 text-neutral-900 p-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Workout Tracker</h1>
          <div className="flex gap-2">
            {userId ? (
              <>
                <span className="text-sm text-neutral-600 hidden sm:inline">{userName || "Signed in"}</span>
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
        </header>

        <Tabs defaultValue="week" className="">
          <TabsList className="grid grid-cols-2 w-full md:w-auto">
            <TabsTrigger value="week">Weekly Tracker</TabsTrigger>
            <TabsTrigger value="resistance">Resistance Session</TabsTrigger>
          </TabsList>

          <TabsContent value="week" className="mt-4">
            <WeeklyTracker weekly={weekly} setWeekly={setWeekly} onReset={resetWeek} />
          </TabsContent>

          <TabsContent value="resistance" className="mt-4">
            <ResistanceView session={session} setSession={setSession} onReset={resetSession} />
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
  const types: WorkoutType[] = ["Resistance", "Cardio", "Mobility", "Other"];

  const counts = useMemo(() => {
    const c: Record<WorkoutType, number> = {
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
  }, [weekly.days]);

  const monday = new Date(weekly.weekOfISO);
  const prettyRange = `${monday.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${
    new Date(weekDates(monday)[6]).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }`;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>Week of {prettyRange}</CardTitle>
          <p className="text-sm text-neutral-500">Click cells to toggle what you did each day.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => onReset()}>
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

// --- Resistance Session ---
function ResistanceView({
  session,
  setSession,
  onReset,
}: {
  session: ResistanceSession;
  setSession: (s: ResistanceSession) => void;
  onReset: () => void;
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Resistance Session – {new Date(session.dateISO).toLocaleDateString()}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-600">
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
  const goalMet = allFirstNMeet || sum >= totalTarget; // your rule

  return (
    <Card className={cn("transition-colors", goalMet && "border-green-500 bg-green-50/40") }>
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
      </CardContent>
    </Card>
  );
}
