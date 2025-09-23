import { useMemo, useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, collection, addDoc, getDocs, deleteDoc } from "firebase/firestore";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Check, RefreshCw, Save } from "lucide-react";

// --- Types ---
type WorkoutType = string; // flexible, user-defined types like 'Bike', 'Calves', 'Resistance', 'Cardio'

type WeeklyDay = {
  dateISO: string; // yyyy-mm-dd
  types: Partial<Record<string, boolean>>; // did I do this type today?
};

type WeeklyPlan = {
  weekOfISO: string; // Monday of week
  weekNumber: number; // Training week number
  days: WeeklyDay[]; // 7 days
  benchmarks: Partial<Record<string, number>>; // target days per type
  customTypes: string[]; // User's custom workout types
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
  sessionTypes: WorkoutType[];
  durationSec?: number;
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
    // default weekly benchmarks (editable per week)
    benchmarks: { Bike: 3, Calves: 4, Resistance: 2, Cardio: 2, Mobility: 2, Other: 1 },
    customTypes: ["Bike", "Calves", "Resistance"],
  };
}

// --- localStorage helpers for global types ---
const LS_TYPES_KEY = "workout:types";
function loadGlobalTypes(): string[] {
  try {
    const raw = localStorage.getItem(LS_TYPES_KEY);
    if (!raw) return ["Bike", "Calves", "Resistance"];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : ["Bike", "Calves", "Resistance"];
  } catch {
    return ["Bike", "Calves", "Resistance"];
  }
}

function ensureUniqueTypes(arr: string[]) {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function saveGlobalTypes(types: string[]) {
  try {
    localStorage.setItem(LS_TYPES_KEY, JSON.stringify(types));
  } catch (e) {
    console.warn("Failed to save global types", e);
  }
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
    sessionTypes: ["Resistance"],
    durationSec: 0,
  };
}

// --- Weekly Overview Component ---
function WeeklyOverview({ weekly }: { weekly: WeeklyPlan }) {
  // normalize today's ISO (yyyy-mm-dd) using local date
  const today = toISO(new Date());
  const todayData = weekly.days.find((d) => d.dateISO === today);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    // initialize counts for custom types
    weekly.customTypes.forEach((t) => (c[t] = 0));
    weekly.days.forEach((d) => {
      Object.keys(d.types).forEach((t) => {
        if (d.types[t]) {
          if (!(t in c)) c[t] = 0;
          c[t] += 1;
        }
      });
    });
    return c;
  }, [weekly.days, weekly.customTypes]);

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
  const [initialized, setInitialized] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Offline cache is configured at Firestore initialization in lib/firebase

  // Auth + initial load
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (u) {
          setUserId(u.uid);
          setUserName(u.displayName || u.email || null);
          // Prefer per-week document keyed by weekOfISO. Fall back to the legacy 'tracker' doc.
          try {
            const weekRef = doc(db, 'users', u.uid, 'state', toISO(getMonday()));
            const wSnap = await getDoc(weekRef);
            if (wSnap.exists()) {
              const data = wSnap.data() as PersistedState;
              if (data?.weekly) {
                // dedupe types
                const uniq = ensureUniqueTypes(data.weekly.customTypes || []);
                setWeekly({ ...data.weekly, customTypes: uniq });
              }
              if (data?.session) setSession(data.session);
            } else {
              // fallback to legacy tracker doc
              const ref = doc(db, "users", u.uid, "state", "tracker");
              const snap = await getDoc(ref);
              if (snap.exists()) {
                const data = snap.data() as PersistedState;
                if (data?.weekly) setWeekly({ ...data.weekly, customTypes: ensureUniqueTypes(data.weekly.customTypes || []) });
                if (data?.session) setSession(data.session);
              }
            }
          } catch (e) {
            console.warn('Failed to load per-week state, falling back to tracker', e);
          }
          // load global types from Firestore if present
          try {
            const settingsRef = doc(db, 'users', u.uid, 'settings', 'types');
            const sSnap = await getDoc(settingsRef);
            if (sSnap.exists()) {
              const t = sSnap.data()?.types;
              if (Array.isArray(t) && t.length > 0) {
                setWeekly((prev) => ({ ...prev, customTypes: ensureUniqueTypes(t) }));
              }
            }
          } catch (e) {
            console.warn('Failed to load settings/types from Firestore', e);
          }
          // finished initial load; enable autosave
          setInitialized(true);
        } else {
          setUserId(null);
          setUserName(null);
          setInitialized(false);
        }
      } finally {
        // finished loading
      }
    });
    return () => unsub();
  }, []);

  // autosave to Firestore
  useEffect(() => {
    // don't autosave until we've loaded the initial state from Firestore
    if (!userId || !initialized) return;
    // autosave to per-week document keyed by weekly.weekOfISO
    try {
      const ref = doc(db, "users", userId, "state", weekly.weekOfISO);
      const payload: PersistedState = { weekly, session };
      setDoc(ref, payload, { merge: true }).catch(() => {});
    } catch (e) {
      console.warn('Autosave failed', e);
    }
  }, [userId, weekly, session]);

  // (debugging removed) -- no console.debug left

  const resetWeek = async () => {
    const base = defaultWeekly();
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setWeekly(base);
      return;
    }
    try {
      const monday = getMonday();
      const prev = new Date(monday);
      prev.setDate(monday.getDate() - 7);
      const prevISO = toISO(prev);
      const ref = doc(db, 'users', uid, 'state', prevISO);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        setWeekly(base);
        return;
      }
      const data = snap.data() as PersistedState;
      const weeklyFromPrev = data.weekly || {} as WeeklyPlan;
      const benchmarks = { ...base.benchmarks, ...(weeklyFromPrev.benchmarks || {}) } as Record<string, number>;
      const customTypes = ensureUniqueTypes([...(weeklyFromPrev.customTypes || base.customTypes)]);
      setWeekly({ ...base, benchmarks, customTypes });
    } catch (e) {
      console.warn('Failed to copy previous week on reset', e);
      setWeekly(base);
    }
  };
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
          <TabsList className="grid grid-cols-4 w-full md:w-auto bg-white/80 backdrop-blur-sm border border-slate-200 shadow-sm">
            <TabsTrigger value="week" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">Weekly Tracker</TabsTrigger>
            <TabsTrigger value="workout" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">Workout Session</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">History</TabsTrigger>
            <TabsTrigger value="library" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">Library</TabsTrigger>
          </TabsList>

          <TabsContent value="week" className="mt-4">
            <WeeklyTracker weekly={weekly} setWeekly={setWeekly} onReset={resetWeek} />
          </TabsContent>

          <TabsContent value="workout" className="mt-4">
            <WorkoutView session={session} setSession={setSession} onReset={resetSession} weekly={weekly} setWeekly={setWeekly} />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <HistoryView />
          </TabsContent>

          <TabsContent value="library" className="mt-4">
            <LibraryView onLoadRoutine={(r) => setSession(r)} />
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
    const c: Record<string, number> = {};
    types.forEach((t) => (c[t] = 0));
    weekly.days.forEach((d) => {
      types.forEach((t) => {
        if (d.types[t]) c[t] += 1;
      });
    });
    return c;
  }, [weekly.days, types]);

  const monday = new Date(weekly.weekOfISO);
  const [newTypeName, setNewTypeName] = useState("");

  // On mount, ensure weekly.customTypes is populated from global settings if needed
  useEffect(() => {
    if (!weekly.customTypes || weekly.customTypes.length === 0) {
      const globals = loadGlobalTypes();
      setWeekly({ ...weekly, customTypes: globals });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addType = () => {
    const name = newTypeName.trim();
    if (!name) return;
    if (weekly.customTypes.includes(name)) {
      setNewTypeName("");
      return;
    }
    const updated = { ...weekly, customTypes: [...weekly.customTypes, name], benchmarks: { ...weekly.benchmarks, [name]: 0 } };
    setWeekly(updated);
    saveGlobalTypes(updated.customTypes);
    // save to Firestore if user signed in
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const ref = doc(db, 'users', uid, 'settings', 'types');
        await setDoc(ref, { types: updated.customTypes }, { merge: true });
      } catch (e) {
        console.warn('Failed to save types to Firestore', e);
      }
    })();
    setNewTypeName("");
  };

  const removeType = (name: string) => {
    const customTypes = weekly.customTypes.filter((t) => t !== name);
    const benchmarks = { ...weekly.benchmarks };
    delete benchmarks[name];
    const days = weekly.days.map((d) => {
      const types = { ...d.types };
      delete types[name];
      return { ...d, types };
    });
    setWeekly({ ...weekly, customTypes, benchmarks, days });
    saveGlobalTypes(customTypes);
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try { await setDoc(doc(db, 'users', uid, 'settings', 'types'), { types: customTypes }, { merge: true }); } catch (e) { console.warn('Failed to save types to Firestore', e); }
    })();
  };

  const renameType = (oldName: string, newName: string) => {
    newName = newName.trim();
    if (!newName || weekly.customTypes.includes(newName)) return;
    const customTypes = weekly.customTypes.map((t) => (t === oldName ? newName : t));
    const benchmarks: Record<string, number> = {};
    Object.keys(weekly.benchmarks).forEach((k) => {
      benchmarks[k === oldName ? newName : k] = weekly.benchmarks[k] ?? 0;
    });
    const days = weekly.days.map((d) => {
      const types: Record<string, boolean> = {};
      Object.keys(d.types).forEach((k) => {
        types[k === oldName ? newName : k] = !!d.types[k];
      });
      return { ...d, types };
    });
    setWeekly({ ...weekly, customTypes, benchmarks, days });
    saveGlobalTypes(customTypes);
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try { await setDoc(doc(db, 'users', uid, 'settings', 'types'), { types: customTypes }, { merge: true }); } catch (e) { console.warn('Failed to save types to Firestore', e); }
    })();
  };

  // --- Modal state for rename / remove ---
  const [showModal, setShowModal] = useState(false);
  const [modalAction, setModalAction] = useState<"rename" | "remove" | null>(null);
  const [targetType, setTargetType] = useState<string | null>(null);
  const [modalInput, setModalInput] = useState("");

  const openRename = (t: string) => {
    setTargetType(t);
    setModalAction("rename");
    setModalInput(t);
    setShowModal(true);
  };

  const openRemove = (t: string) => {
    setTargetType(t);
    setModalAction("remove");
    setModalInput(t);
    setShowModal(true);
  };

  const confirmModal = () => {
    if (!modalAction || !targetType) return;
    if (modalAction === "rename") {
      renameType(targetType, modalInput);
    } else if (modalAction === "remove") {
      // perform removal
      if (modalInput === targetType) {
        removeType(targetType);
      }
    }
    setShowModal(false);
    setModalAction(null);
    setTargetType(null);
    setModalInput("");
  };


  // --- Render type management UI ---
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
          <Button variant="outline" onClick={async () => {
            // copy previous week from Firestore if signed in
            const uid = auth.currentUser?.uid;
            if (!uid) { alert('Sign in to copy previous week'); return; }
            const prevMonday = new Date(monday);
            prevMonday.setDate(monday.getDate() - 7);
            const prevISO = toISO(prevMonday);
            try {
              const ref = doc(db, 'users', uid, 'state', prevISO);
              const snap = await getDoc(ref);
              if (!snap.exists()) { alert('No saved data for previous week'); return; }
              const data = snap.data() as PersistedState;
              if (data?.weekly) {
                setWeekly({ ...weekly, benchmarks: data.weekly.benchmarks, customTypes: data.weekly.customTypes });
                saveGlobalTypes(data.weekly.customTypes || []);
                // persist to current week doc
                await setDoc(doc(db, 'users', uid, 'state', weekly.weekOfISO), { weekly: { ...weekly, benchmarks: data.weekly.benchmarks, customTypes: data.weekly.customTypes } }, { merge: true });
                alert('Copied previous week settings');
              }
            } catch (e) { console.error('Copy previous week failed', e); alert('Failed to copy previous week'); }
          }}>Copy previous week</Button>
          <Button variant="secondary" onClick={async () => {
            const uid = auth.currentUser?.uid;
            if (!uid) { alert('Sign in to save settings'); return; }
            try {
              await setDoc(doc(db, 'users', uid, 'state', weekly.weekOfISO), { weekly: { benchmarks: weekly.benchmarks, customTypes: weekly.customTypes } }, { merge: true });
              alert('Weekly settings saved');
            } catch (e) { console.error('Save settings failed', e); alert('Failed to save settings'); }
          }} className="bg-white hover:bg-slate-50">
            <Save className="mr-2 h-4 w-4" /> Save settings
          </Button>
        </div>
      </CardHeader>
      {/* Weekly table */}
      

      {/* Manage types (moved lower and collapsed) */}
      <CardContent>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold mb-2">Manage workout types</summary>
          <div className="mt-2">
            <div className="flex gap-2 items-center mb-2">
              <Input value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} placeholder="New type name" />
              <Button onClick={addType} className="ml-2"><Plus className="mr-2 h-4 w-4"/> Add Type</Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {weekly.customTypes.map((t) => (
                <div key={t} className="flex items-center gap-2 bg-slate-100 px-2 py-1 rounded">
                  <span className="text-sm font-medium">{t}</span>
                  <button className="text-xs text-blue-600 hover:underline" onClick={() => openRename(t)}>Rename</button>
                  <button className="text-xs text-red-600 hover:underline" onClick={() => openRemove(t)}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        </details>
      </CardContent>

      {/* Modal for rename/remove */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-2">{modalAction === 'rename' ? 'Rename type' : 'Remove type'}</h3>
            {modalAction === 'rename' ? (
              <div className="space-y-2">
                <Input value={modalInput} onChange={(e) => setModalInput(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                  <Button onClick={confirmModal}>Save</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm">Type the name of the type (<strong>{targetType}</strong>) to confirm removal.</p>
                <Input value={modalInput} onChange={(e) => setModalInput(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={confirmModal}>Remove</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <CardContent>
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white text-left p-2 border-b">Type</th>
                {weekly.days.map((d) => (
                  <th key={d.dateISO} className="p-2 text-xs font-medium border-b">
                    {new Date(d.dateISO + 'T00:00').toLocaleDateString(undefined, { weekday: "short" })}
                    <div className="text-[10px] text-neutral-500">{new Date(d.dateISO + 'T00:00').getDate()}</div>
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
                              const newTypes = { ...day.types, [t]: !active } as Record<string, boolean>;
                              // If bike is toggled on, also mark Cardio
                              if (t === 'Bike' && !active) newTypes['Cardio'] = true;
                              // If Cardio turned off while Bike is on, keep Cardio if Bike is true
                              if (t === 'Cardio' && !newTypes['Cardio'] && newTypes['Bike']) newTypes['Cardio'] = true;
                              day.types = newTypes;
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
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSec, setTimerSec] = useState<number>(session.durationSec || 0);
  const [routines, setRoutines] = useState<any[]>([]);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);

  useEffect(() => {
    let id: any = null;
    if (timerRunning) {
      id = setInterval(() => setTimerSec((s) => s + 1), 1000);
    }
    return () => {
      if (id) clearInterval(id);
    };
  }, [timerRunning]);

  useEffect(() => {
    // keep session.durationSec in sync while editing
    setSession({ ...session, durationSec: timerSec });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerSec]);

  const formatTime = (s: number) => {
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
  };

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
    setSession({ ...session, completed: true, durationSec: timerSec });
    
    // Auto-populate weekly tracker
    const today = session.dateISO;
    const todayIndex = weekly.days.findIndex(d => d.dateISO === today);
    if (todayIndex !== -1) {
      const updatedDays = [...weekly.days];
      const markTypes: string[] = [...session.sessionTypes];
      // if Bike is present, also mark Cardio implicitly
      if (markTypes.includes("Bike") && !markTypes.includes("Cardio")) markTypes.push("Cardio");
      const newTypes = { ...updatedDays[todayIndex].types } as Record<string, boolean>;
      markTypes.forEach((t) => { newTypes[t] = true; });
      updatedDays[todayIndex] = { ...updatedDays[todayIndex], types: newTypes };
      setWeekly({ ...weekly, days: updatedDays });
    }
    // persist completed session to Firestore under users/{uid}/sessions
    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const payload = { ...session, durationSec: timerSec, completedAt: Date.now() };
        await addDoc(collection(db, 'users', uid, 'sessions'), payload as any);
      } catch (e) {
        console.error('Failed to save completed session', e);
      }
    })();
    // stop the timer when completed
    setTimerRunning(false);
  };

  // Save current session as a routine/template (no results)
  const saveRoutine = async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        alert('Please sign in to save routines');
        return;
      }
      const payload = {
        name: session.sessionName || 'Routine',
        exercises: session.exercises.map((e) => ({ id: e.id, name: e.name, minSets: e.minSets, targetReps: e.targetReps })),
        sessionTypes: session.sessionTypes,
        createdAt: Date.now(),
      };
      const ref = collection(db, 'users', uid, 'routines');
      await addDoc(ref, payload as any);
      alert('Routine saved');
    } catch (e) {
      console.error('Save routine failed', e);
      alert('Save failed');
    }
  };

  const loadRoutines = async () => {
    // show modal selection — load routines into local state for modal
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) { alert('Please sign in to load routines'); return; }
      const ref = collection(db, 'users', uid, 'routines');
      const snaps = await getDocs(ref);
      const items = snaps.docs.map((s) => ({ id: s.id, ...(s.data() as any) }));
      if (items.length === 0) { alert('No routines saved'); return; }
      setRoutines(items);
      setShowLoadModal(true);
    } catch (e) {
      console.error('Load routines failed', e);
      alert('Load failed');
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
                <div className="text-sm text-neutral-700">Timer: {formatTime(timerSec)}</div>
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
        <Button variant="secondary" onClick={saveRoutine}>
          <Save className="mr-2 h-4 w-4"/> Save Routine
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
                if (!found) return alert('Select a routine');
                const exercises = (found.exercises || []).map((e: any) => ({ id: crypto.randomUUID(), name: e.name, minSets: e.minSets, targetReps: e.targetReps, sets: Array(e.minSets).fill(0) }));
                setSession({ ...session, sessionName: found.name, exercises, completed: false, sessionTypes: found.sessionTypes || [], durationSec: 0 });
                setShowLoadModal(false);
                setSelectedRoutineId(null);
              }}>Load selected</Button>
            </div>
          </div>
        </div>
      )}
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

function HistoryView() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) {
          setItems([]);
          setLoading(false);
          return;
        }
        const ref = collection(db, 'users', uid, 'sessions');
        const snaps = await getDocs(ref);
        const data = snaps.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        if (mounted) setItems(data.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)));
      } catch (e) {
        console.error('Load history failed', e);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  if (loading) return <div>Loading...</div>;
  if (items.length === 0) return <div className="text-sm text-neutral-600">No history yet. Complete sessions will appear here.</div>;

  return (
    <div className="space-y-3">
      {items.map((it) => (
        <Card key={it.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{it.sessionName}</div>
                <div className="text-xs text-neutral-600">{new Date((it.completedAt || it.ts || Date.now()) ).toLocaleString()}</div>
              </div>
              <div className="text-sm text-neutral-600">{(it.exercises || []).length} exercises</div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              {(it.sessionTypes || []).join(', ')}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LibraryView({ onLoadRoutine }: { onLoadRoutine: (s: ResistanceSession) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<any | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const loadList = async () => {
    setLoading(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) { setItems([]); setLoading(false); return; }
      const ref = collection(db, 'users', uid, 'routines');
      const snaps = await getDocs(ref);
      const data = snaps.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setItems(data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    } catch (e) {
      console.error('Load routines list failed', e);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadList(); }, []);

  if (loading) return <div>Loading routines...</div>;
  if (items.length === 0) return <div className="text-sm text-neutral-600">No routines yet. Save a session to add one.</div>;

  return (
    <div className="space-y-3">
      {items.map((it) => (
        <Card key={it.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{it.name}</div>
                <div className="text-xs text-neutral-600">{(it.exercises || []).length} exercises</div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => {
                  const exercises = (it.exercises || []).map((e: any) => ({ id: crypto.randomUUID(), name: e.name, minSets: e.minSets, targetReps: e.targetReps, sets: Array(e.minSets).fill(0) }));
                  onLoadRoutine({ dateISO: toISO(new Date()), sessionName: it.name, exercises, completed: false, sessionTypes: it.sessionTypes || [], durationSec: 0 });
                }}>Load</Button>
                <Button variant="outline" onClick={() => { setRenameTarget(it); setRenameValue(it.name); setShowRenameModal(true); }}>Rename</Button>
                <Button variant="destructive" onClick={() => { setDeleteTarget(it); setShowDeleteModal(true); }}>Delete</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-sm">{(it.sessionTypes || []).join(', ')}</div>
          </CardContent>
        </Card>
      ))}
      {/* Rename modal inside component */}
      {showRenameModal && renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-2">Rename routine</h3>
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => { setShowRenameModal(false); setRenameTarget(null); }}>Cancel</Button>
              <Button onClick={async () => {
                if (!renameValue) return;
                try {
                  const uid = auth.currentUser?.uid; if (!uid) return alert('Sign in');
                  await setDoc(doc(db, 'users', uid, 'routines', renameTarget.id), { name: renameValue }, { merge: true });
                  setShowRenameModal(false);
                  setRenameTarget(null);
                  loadList();
                } catch (e) { console.error('Rename failed', e); }
              }}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal inside component */}
      {showDeleteModal && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-2">Delete routine</h3>
            <p className="text-sm">Are you sure you want to delete <strong>{deleteTarget.name}</strong>?</p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => { setShowDeleteModal(false); setDeleteTarget(null); }}>Cancel</Button>
              <Button variant="destructive" onClick={async () => {
                try {
                  const uid = auth.currentUser?.uid; if (!uid) return alert('Sign in');
                  await deleteDoc(doc(db, 'users', uid, 'routines', deleteTarget.id));
                  setShowDeleteModal(false); setDeleteTarget(null); loadList();
                } catch (e) { console.error('Delete failed', e); }
              }}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
