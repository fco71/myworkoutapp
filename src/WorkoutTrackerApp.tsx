import { useMemo, useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, collection, addDoc, getDocs, deleteDoc, query, where, collectionGroup } from "firebase/firestore";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Check, RefreshCw, Save, Bookmark } from "lucide-react";
import { ToastContainer } from "@/components/ui/toast";

// --- Types ---
type WorkoutType = string; // flexible, user-defined types like 'Bike', 'Calves', 'Resistance', 'Cardio'

type WeeklyDay = {
  dateISO: string; // yyyy-mm-dd
  types: Partial<Record<string, boolean>>; // did I do this type today?
  sessions?: number; // legacy/simple count of sessions completed that day
  sessionsList?: { id?: string; sessionTypes: WorkoutType[] }[]; // detailed sessions per day
};

type WeeklyPlan = {
  weekOfISO: string; // Monday of week
  weekNumber: number; // Training week number
  days: WeeklyDay[]; // 7 days
  benchmarks: Partial<Record<string, number>>; // target days per type
  customTypes: string[]; // User's custom workout types
  typeCategories?: Record<string, string>; // optional mapping type -> category (e.g., Bike: Cardio)
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
  sourceTemplateId?: string; // optional id of originating library routine/exercise
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

// Safe stringify helper for debugging (handles circulars)
function safeString(o: any, space = 2) {
  try {
    return JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? String(v) : v), space);
  } catch (e) {
    try {
      return String(o);
    } catch {
      return '<unstringifiable>';
    }
  }
}

// --- Persistence (Firebase Firestore) ---
type PersistedState = { weekly: WeeklyPlan; session: ResistanceSession };

// --- Seed Defaults ---
function defaultWeekly(): WeeklyPlan {
  const monday = getMonday();
  const days = weekDates(monday).map((d) => ({
    dateISO: toISO(d),
    types: {},
    sessions: 0,
    sessionsList: [],
  }));
  return {
    weekOfISO: toISO(monday),
    weekNumber: 1,
    days,
    // default weekly benchmarks (editable per week)
    benchmarks: { Bike: 3, Calves: 4, Resistance: 2, Cardio: 2, Mobility: 2, Other: 1, Mindfulness: 3 },
  customTypes: ["Bike", "Calves", "Rings", "Mindfulness"],
  typeCategories: { Bike: 'Cardio', Calves: 'None', Rings: 'Resistance', Mindfulness: 'Mindfulness' },
  };
}

// --- Toast helper (non-blocking feedback) ---
function useToasts() {
  const [messages, setMessages] = useState<{ id: string; text: string; kind?: 'info' | 'success' | 'error' }[]>([]);
  const push = (text: string, kind?: 'info' | 'success' | 'error') => {
    const id = crypto.randomUUID();
    setMessages((s) => [...s, { id, text, kind }]);
  };
  const dismiss = (id: string) => setMessages((s) => s.filter((m) => m.id !== id));
  return { messages, push, dismiss };
}

// --- localStorage helpers for global types ---
const LS_TYPES_KEY = "workout:types";
function loadGlobalTypes(): string[] {
  try {
    const raw = localStorage.getItem(LS_TYPES_KEY);
    if (!raw) return ["Bike", "Calves", "Rings"];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.types)) return parsed.types;
    if (Array.isArray(parsed)) return parsed;
    return ["Bike", "Calves", "Rings"];
  } catch {
    return ["Bike", "Calves", "Rings"];
  }
}
function loadTypeCategories(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_TYPES_KEY);
    if (!raw) return { Bike: 'Cardio', Calves: 'None', Rings: 'Resistance' };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.categories) return parsed.categories;
    return { Bike: 'Cardio', Calves: 'None', Rings: 'Resistance' };
  } catch {
    return { Bike: 'Cardio', Calves: 'None', Rings: 'Resistance' };
  }
}

function ensureUniqueTypes(arr: string[]) {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function normalizeWeekly(w: WeeklyPlan): WeeklyPlan {
  const customTypes = ensureUniqueTypes(w.customTypes || []);
  // ensure benchmarks keys exist for each customType
  const benchmarks: Record<string, number> = { ...(w.benchmarks || {}) } as Record<string, number>;
  customTypes.forEach((t) => {
    if (!(t in benchmarks)) benchmarks[t] = 0;
  });
  // normalize days types to boolean
  const days = (w.days || []).map((d) => {
    const types: Record<string, boolean> = {};
    Object.keys(d.types || {}).forEach((k) => {
      const kk = String(k).trim();
      if (!kk) return;
      types[kk] = !!d.types[k];
    });
    // normalize sessionsList and dedupe by id or by JSON
    const rawList = Array.isArray(d.sessionsList) ? d.sessionsList : [];
    const seen = new Set<string>();
    const sessionsList = rawList.reduce((acc: any[], s: any) => {
      const key = s?.id ? String(s.id) : JSON.stringify(s?.sessionTypes || s);
      if (seen.has(key)) return acc;
      seen.add(key);
      acc.push({ id: s?.id, sessionTypes: Array.isArray(s?.sessionTypes) ? s.sessionTypes : [] });
      return acc;
    }, []);
    return { ...d, types, sessions: typeof d.sessions === 'number' ? d.sessions : (sessionsList.length || 0), sessionsList };
  });
  return { ...w, customTypes, benchmarks, days };
}

// Play a short beep using WebAudio API
function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.value = 0.1;
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 500);
  } catch (e) {
    // fallback: try simple alert sound
    try { new Audio().play(); } catch (_) {}
  }
}

// rebuildWeeklyFromSessions removed — weekly state is authoritative and driven by checkbox 'workouts' only

function saveGlobalTypes(types: string[], categories?: Record<string, string>) {
  try {
    const payload: any = { types };
    if (categories) payload.categories = categories;
    // preserve existing categories if present and not overwritten
    try {
      const raw = localStorage.getItem(LS_TYPES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!payload.categories && parsed && parsed.categories) payload.categories = parsed.categories;
      }
    } catch {}
    localStorage.setItem(LS_TYPES_KEY, JSON.stringify(payload));
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

// guard set to avoid double-processing of completeWorkout for same session object
const completedGuards = new WeakSet<object>();

// localStorage routines helpers
const LS_ROUTINES = 'workout:routines';
function loadLocalRoutines() {
  try {
    const raw = localStorage.getItem(LS_ROUTINES);
    if (!raw) return [] as any[];
    return JSON.parse(raw) as any[];
  } catch { return [] as any[]; }
}
function saveLocalRoutine(item: any) {
  try {
    const cur = loadLocalRoutines();
    cur.unshift(item);
    localStorage.setItem(LS_ROUTINES, JSON.stringify(cur.slice(0, 100)));
  } catch (e) { console.warn('Failed to save local routine', e); }
}

// no local exercises -- exercises are a database feature (persisted in Firestore)

// --- Weekly Overview Component ---
function WeeklyOverview({ weekly }: { weekly: WeeklyPlan }) {
  // normalize today's ISO (yyyy-mm-dd) using local date
  const today = toISO(new Date());

  // New behavior: counts are simple checkbox counts only (the user requested
  // the header counters to reflect clicks). We ignore sessionsList/sessions
  // for these counters entirely.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    weekly.customTypes.forEach((t) => (c[t] = 0));
    weekly.days.forEach((d) => {
      Object.keys(d.types || {}).forEach((t) => {
        if (d.types[t]) {
          if (!(t in c)) c[t] = 0;
          c[t] += 1;
        }
      });
    });
    console.debug('[WT] WeeklyOverview counts computed', safeString({ counts: c, days: weekly.days.map(d => ({ dateISO: d.dateISO, types: d.types, sessions: d.sessions, sessionsList: d.sessionsList })) }));
    return c;
  }, [weekly.days, weekly.customTypes]);

  // New simple counters based purely on checkbox clicks (no sessionsList/sessions):
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

  // debug: compute unique session ids across the week and show per-day details
    try {
    const allIds: string[] = [];
    weekly.days.forEach((d) => {
      (d.sessionsList || []).forEach((s: any) => { if (s?.id) allIds.push(String(s.id)); else allIds.push(JSON.stringify(s.sessionTypes || s)); });
    });
  const uniqueIds = Array.from(new Set(allIds));
  const perDay = weekly.days.map(d => ({ dateISO: d.dateISO, sessionsList: (d.sessionsList || []).map((s:any)=> ({ id: s?.id, sessionTypes: s.sessionTypes })) , sessions: d.sessions }));
  console.debug('[WT] Week summary', safeString({ weekOfISO: weekly.weekOfISO, weekClicks: weekly.days.reduce((acc,d)=>acc+Object.values(d.types||{}).filter(Boolean).length,0), uniqueSessionCount: uniqueIds.length, uniqueIds, perDay, counts }));
  } catch (e) {
    console.warn('[WT] Week summary debug failed', safeString(e));
  }

  return (
    <div className="space-y-4 mb-8">
      {/* Week Number */}
      <div className="flex items-center justify-between">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold">Week {weekly.weekNumber}</h2>
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
      
  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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

  {/* Resistance Progress */}
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

      {/* Cardio Progress */}
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
      {/* Mindfulness Progress */}
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
  // top-level toasts container for non-blocking messages
  const appToasts = useToasts();
  // (celebration UI removed per user request)

  // keep a global favorites snapshot map to keep optimistic updates reconciled across components
  // This will be populated via a listener when a user signs in (see effect below in child components)
  // Exposed via a simple ref-like object pattern (we attach to window for quick debug in dev)
  // Note: we don't persist anything here; this is an app-level cache to avoid stale optimistic UI.
  (window as any).__app_favorites_cache = (window as any).__app_favorites_cache || { map: new Map<string, boolean>() };

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
                // dedupe types and normalize
                const uniq = ensureUniqueTypes(data.weekly.customTypes || []);
                  let normalized = normalizeWeekly({ ...data.weekly, customTypes: uniq } as WeeklyPlan);
                  console.debug('[WT] Loaded per-week state (raw)', safeString({ uid: u.uid, week: toISO(getMonday()), normalized }));
                  // if the loaded weekly has no customTypes, merge defaults from local/global settings
                  if (!normalized.customTypes || normalized.customTypes.length === 0) {
                    const globals = loadGlobalTypes();
                    const categories = loadTypeCategories();
                    normalized = normalizeWeekly({ ...normalized, customTypes: globals, typeCategories: { ...(normalized.typeCategories||{}), ...(categories||{}) } } as WeeklyPlan);
                  }
                  // Always attempt to reconstruct sessionsList from users/{uid}/sessions collection
                  try {
                    const snaps = await getDocs(collection(db, 'users', u.uid, 'sessions'));
                    const items = snaps.docs.map(s => ({ id: s.id, ...(s.data() as any) }));
                    console.debug('[WT] sessions collection loaded', safeString({ uid: u.uid, count: items.length, sample: items.slice(0,5) }));
                      if (items.length > 0) {
                      // build map dateISO -> sessions
                      const dateMap: Record<string, any[]> = {};
                      normalized.days.forEach(d => { dateMap[d.dateISO] = []; });
                      items.forEach(it => {
                        // try multiple fields for a date
                        let d: string | null = null;
                        if (it.dateISO) d = it.dateISO;
                        else if (it.date) d = it.date;
                        else if (it.completedAt) d = toISO(new Date(it.completedAt));
                        else if (it.createdAt) d = toISO(new Date(it.createdAt));
                        else if (it.ts) d = toISO(new Date(it.ts));
                        // fallback: if no date fields, try parsing payload
                        if (!d && it.timestamp) d = toISO(new Date(it.timestamp));
                        if (!d) {
                          try { d = toISO(new Date(it)); } catch { d = null; }
                        }
                        if (d && dateMap[d]) {
                          dateMap[d].push(it);
                        }
                      });
                      const days = normalized.days.map(d => ({ ...d, sessionsList: (dateMap[d.dateISO] || []).map(s => ({ id: s.id, sessionTypes: s.sessionTypes || [] })), sessions: (dateMap[d.dateISO] || []).length }));
                      normalized = { ...normalized, days };
                      console.debug('[WT] Reconstructed sessionsList from sessions collection', safeString({ uid: u.uid, reconstructed: days.map(dd => ({ dateISO: dd.dateISO, sessions: dd.sessions, sessionsListLen: (dd.sessionsList||[]).length })) }));
                      // persist reconstructed weekly so subsequent loads use sessionsList
                      // Persist reconstructed weekly removed per app decision (weekly doc is authoritative)
                    }
                  } catch (e) {
                    console.warn('[WT] Failed to reconstruct sessionsList from sessions collection', e);
                  }
                  setWeekly(normalized);
              }
              if (data?.session) setSession(data.session);
            } else {
              // fallback to legacy tracker doc
              const ref = doc(db, "users", u.uid, "state", "tracker");
              const snap = await getDoc(ref);
              if (snap.exists()) {
                const data = snap.data() as PersistedState;
                if (data?.weekly) {
                  const normalized = normalizeWeekly({ ...data.weekly, customTypes: ensureUniqueTypes(data.weekly.customTypes || []) } as WeeklyPlan);
                  console.debug('[WT] Loaded legacy tracker state', { uid: u.uid, normalized });
                  setWeekly(normalized);
                }
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
              const data = sSnap.data() as any;
              const t = data?.types;
              const cats = data?.categories || data?.typeCategories || {};
              if (Array.isArray(t) && t.length > 0) {
                  const custom = ensureUniqueTypes(t);
                  console.debug('[WT] Loaded global types from settings', safeString({ uid: u.uid, custom, categories: cats }));
                  // apply both custom types and categories to weekly state
                  setWeekly((prev) => normalizeWeekly({ ...prev, customTypes: custom, typeCategories: { ...(prev.typeCategories || {}), ...(cats || {}) } } as WeeklyPlan));
                  // persist categories to localStorage for fast local loads
                  try { saveGlobalTypes(custom, { ...(loadTypeCategories() || {}), ...(cats || {}) }); } catch (e) { /* ignore */ }
              } else if (cats && Object.keys(cats).length > 0) {
                  // if only categories present, merge into weekly and persist locally
                  console.debug('[WT] Loaded categories from settings', safeString({ uid: u.uid, categories: cats }));
                  setWeekly((prev) => {
                    const updated = { ...prev, typeCategories: { ...(prev.typeCategories || {}), ...(cats || {}) } } as WeeklyPlan;
                    try { saveGlobalTypes(updated.customTypes || loadGlobalTypes(), { ...(loadTypeCategories() || {}), ...(cats || {}) }); } catch (e) { /* ignore */ }
                    return normalizeWeekly(updated);
                  });
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

  // celebration and debug override removed

  // confetti and celebration removed

  // ...existing code...

  // Global floating countdown timer
  const [countdownSec, setCountdownSec] = useState<number>(0);
  const [countdownRunning, setCountdownRunning] = useState(false);
  const [showCountdownModal, setShowCountdownModal] = useState(false);

  // persist last-used countdown in localStorage
  const LS_COUNTDOWN = 'workout:last_countdown_sec';
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_COUNTDOWN);
      if (raw) {
        const v = parseInt(raw || '0');
        if (!isNaN(v) && v > 0) setCountdownSec(v);
      }
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!countdownRunning) return;
    const id = setInterval(() => {
      setCountdownSec((s) => {
        if (s <= 1) {
          setCountdownRunning(false);
          playBeep();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [countdownRunning]);

  // (debugging removed) -- no console.debug left

  const resetWeek = async () => {
    const base = defaultWeekly();
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setWeekly(normalizeWeekly(base));
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
        setWeekly(normalizeWeekly(base));
        return;
      }
      const data = snap.data() as PersistedState;
      const weeklyFromPrev = data.weekly || ({} as WeeklyPlan);
      const benchmarks = { ...base.benchmarks, ...(weeklyFromPrev.benchmarks || {}) } as Record<string, number>;
      const customTypes = ensureUniqueTypes([...(weeklyFromPrev.customTypes || base.customTypes)]);
      setWeekly(normalizeWeekly({ ...base, benchmarks, customTypes } as WeeklyPlan));
    } catch (e) {
      console.warn('Failed to copy previous week on reset', e);
      setWeekly(base);
    }
  };
  // resetSession removed — session resets are no longer part of UI flow

  return (
  <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 text-slate-900 p-6 relative z-10">
      {/* Mindfulness overlay when weekly Mindfulness goal met */}
      {(() => {
        try {
          const target = weekly.benchmarks?.['Mindfulness'] || 0;
          // count types that are either explicitly named Mindfulness or categorized as Mindfulness
          const typeCats = weekly.typeCategories || {};
          const count = weekly.days.reduce((acc, d) => {
            return acc + Object.keys(d.types || {}).filter(t => d.types?.[t] && (typeCats[t] === 'Mindfulness' || t === 'Mindfulness')).length;
          }, 0);

          // Debug override: allow forcing the overlay via URL param or localStorage key while testing
          let force = false;
          try {
            const params = new URLSearchParams(window.location.search);
            if (params.get('mindfulness_demo') === '1') force = true;
            const ls = localStorage.getItem('mindfulness:demo');
            if (!force && ls && (ls === '1' || ls === 'true')) force = true;
          } catch (e) { /* ignore in non-browser env */ }

          if (force || (target > 0 && count >= target)) {
            return <div className="fixed inset-0 z-40 mindfulness-overlay pointer-events-none"></div>;
          }
        } catch (e) { /* ignore */ }
        return null;
      })()}
      <div className="mx-auto max-w-6xl">
        {/* celebration UI removed */}
  <ToastContainer messages={appToasts.messages} onDismiss={appToasts.dismiss} />
        <header className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Lifestyle Tracker
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
              {/* Debug and repair buttons removed to reduce clutter */}
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
  <WeeklyTracker weekly={weekly} setWeekly={setWeekly} onReset={resetWeek} push={appToasts.push} />
          </TabsContent>

          <TabsContent value="workout" className="mt-4">
            <WorkoutView session={session} setSession={setSession} weekly={weekly} setWeekly={setWeekly} />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <HistoryView weekly={weekly} setWeekly={setWeekly} />
          </TabsContent>

          <TabsContent value="library" className="mt-4">
            <LibraryView onLoadRoutine={(r, mode) => {
              if (mode === 'append') {
                setSession((prev) => ({ ...prev, exercises: [...prev.exercises, ...(r.exercises || [])] } as ResistanceSession));
              } else {
                setSession(r);
              }
            }} />
          </TabsContent>
        </Tabs>
      </div>
        {/* Floating countdown button */}
        <div className="fixed right-6 bottom-6 z-50">
          <div className="relative">
            <button className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg" onClick={() => setShowCountdownModal(true)}>
              ⏱️
            </button>
            {countdownRunning && (
              <div className="absolute -top-2 -right-2 bg-red-600 text-white text-xs rounded-full px-2 py-0.5">{Math.floor(countdownSec/60)}:{String(countdownSec%60).padStart(2,'0')}</div>
            )}
          </div>
        </div>

        {/* Countdown modal */}
        {showCountdownModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50">
            <div className="bg-white p-6 rounded-lg w-full max-w-md">
              <h3 className="text-lg font-semibold mb-2">Set countdown</h3>
              <div className="flex gap-2 items-center">
                <Input type="number" placeholder="minutes" value={Math.floor(countdownSec/60)} onChange={(e) => setCountdownSec(Math.max(0, parseInt(e.target.value||'0')*60))} />
                <Input type="number" placeholder="seconds" value={countdownSec%60} onChange={(e) => setCountdownSec(Math.max(0, (Math.floor(countdownSec/60)*60) + parseInt(e.target.value||'0')))} />
              </div>
              <div className="flex gap-2 mt-3">
                {[30,60,90,120,180].map(s => (
                  <Button key={s} variant="outline" onClick={() => setCountdownSec(s)}>{`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}</Button>
                ))}
                {(() => {
                  try {
                    const last = parseInt(localStorage.getItem(LS_COUNTDOWN) || '0');
                    if (!isNaN(last) && last > 0) {
                      const mm = Math.floor(last/60); const ss = String(last%60).padStart(2,'0');
                      return <Button variant="secondary" onClick={() => setCountdownSec(last)}>{`${mm}:${ss} (Last)`}</Button>;
                    }
                  } catch (e) { /* ignore */ }
                  return null;
                })()}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => { setShowCountdownModal(false); }}>Close</Button>
                {!countdownRunning ? (
                  <Button onClick={() => { if (countdownSec>0) { try { localStorage.setItem(LS_COUNTDOWN, String(countdownSec)); } catch (e) {} setCountdownRunning(true); } setShowCountdownModal(false); }}>Start</Button>
                ) : (
                  <Button variant="destructive" onClick={() => { setCountdownRunning(false); setCountdownSec(0); setShowCountdownModal(false); }}>Stop</Button>
                )}
              </div>
            </div>
          </div>
        )}
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
  push,
}: {
  weekly: WeeklyPlan;
  setWeekly: (w: WeeklyPlan) => void;
  onReset: () => void;
  push?: (text: string, kind?: 'info'|'success'|'error') => void;
}) {
  const types = weekly.customTypes;
  const [typesPanelOpen, setTypesPanelOpen] = useState(false);

  const counts = useMemo(() => {
    // Counts should mirror the header: simple checkbox counts only.
    const c: Record<string, number> = {};
    types.forEach((t) => (c[t] = 0));
    weekly.days.forEach((d) => {
      types.forEach((t) => { if (d.types[t]) c[t] += 1; });
      // Bike implies Cardio for totals when Cardio not explicitly checked
      if (d.types['Bike']) {
        if (!('Cardio' in c)) c['Cardio'] = 0;
        if (!d.types['Cardio']) c['Cardio'] += 1;
      }
    });
    return c;
  }, [weekly.days, types]);

  const monday = new Date(weekly.weekOfISO);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeCategory, setNewTypeCategory] = useState<string>("None");

  // On mount, ensure weekly.customTypes is populated from global settings if needed
  useEffect(() => {
    if (!weekly.customTypes || weekly.customTypes.length === 0) {
      const globals = loadGlobalTypes();
      const categories = loadTypeCategories();
      setWeekly({ ...weekly, customTypes: globals, typeCategories: categories });
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
    const updatedCats = { ...(weekly.typeCategories || {}) } as Record<string,string>;
    updatedCats[name] = newTypeCategory || 'None';
    const updated = { ...weekly, customTypes: [...weekly.customTypes, name], benchmarks: { ...weekly.benchmarks, [name]: 0 }, typeCategories: updatedCats };
    setWeekly(updated);
    saveGlobalTypes(updated.customTypes, updatedCats);
    // save to Firestore if user signed in
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const ref = doc(db, 'users', uid, 'settings', 'types');
        await setDoc(ref, { types: updated.customTypes, categories: updated.typeCategories || {} }, { merge: true });
      } catch (e) {
        console.warn('Failed to save types to Firestore', e);
      }
    })();
    setNewTypeName("");
    // ensure the manage types panel is visible so users notice the new type
    setTypesPanelOpen(true);
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
  const newCats = { ...(weekly.typeCategories || {}) };
  delete newCats[name];
  setWeekly({ ...weekly, customTypes, benchmarks, days, typeCategories: newCats });
  saveGlobalTypes(customTypes, newCats);
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try { await setDoc(doc(db, 'users', uid, 'settings', 'types'), { types: customTypes, categories: newCats }, { merge: true }); } catch (e) { console.warn('Failed to save types to Firestore', e); }
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
  // also update categories mapping
  const cats: Record<string,string> = {};
  Object.keys(weekly.typeCategories || {}).forEach(k => { cats[k === oldName ? newName : k] = weekly.typeCategories?.[k] ?? 'None'; });
  setWeekly({ ...weekly, customTypes, benchmarks, days, typeCategories: cats });
  saveGlobalTypes(customTypes, cats);
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try { await setDoc(doc(db, 'users', uid, 'settings', 'types'), { types: customTypes, categories: cats }, { merge: true }); } catch (e) { console.warn('Failed to save types to Firestore', e); }
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
            if (!uid) { push?.('Sign in to copy previous week', 'info'); return; }
            const prevMonday = new Date(monday);
            prevMonday.setDate(monday.getDate() - 7);
            const prevISO = toISO(prevMonday);
            try {
              const ref = doc(db, 'users', uid, 'state', prevISO);
              const snap = await getDoc(ref);
              if (!snap.exists()) { push?.('No saved data for previous week', 'info'); return; }
              const data = snap.data() as PersistedState;
              if (data?.weekly) {
                setWeekly({ ...weekly, benchmarks: data.weekly.benchmarks, customTypes: data.weekly.customTypes });
                saveGlobalTypes(data.weekly.customTypes || []);
                // persist to current week doc
                await setDoc(doc(db, 'users', uid, 'state', weekly.weekOfISO), { weekly: { ...weekly, benchmarks: data.weekly.benchmarks, customTypes: data.weekly.customTypes } }, { merge: true });
                push?.('Copied previous week settings', 'success');
              }
            } catch (e) { console.error('Copy previous week failed', e); push?.('Failed to copy previous week', 'error'); }
          }}>Copy previous week</Button>
          <Button variant="secondary" onClick={async () => {
            const uid = auth.currentUser?.uid;
            if (!uid) { push?.('Sign in to save settings', 'info'); return; }
            try {
              await setDoc(doc(db, 'users', uid, 'state', weekly.weekOfISO), { weekly: { benchmarks: weekly.benchmarks, customTypes: weekly.customTypes } }, { merge: true });
              push?.('Weekly settings saved', 'success');
            } catch (e) { console.error('Save settings failed', e); push?.('Failed to save settings', 'error'); }
          }} className="bg-white hover:bg-slate-50">
            <Save className="mr-2 h-4 w-4" /> Save settings
          </Button>
          {/* Rebuild from sessions removed per user request */}
          {/* Clear/repair buttons removed from header per user request */}
        </div>
      </CardHeader>
      {/* Weekly table */}
      

      {/* Manage types (moved lower and collapsed) */}
      <CardContent>
        <details className="mt-4" open={typesPanelOpen}>
          <summary className="cursor-pointer text-sm font-semibold mb-2">Manage lifestyle types</summary>
          <div className="mt-2">
            <div className="flex gap-2 items-center mb-2">
              <Input value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} placeholder="New type name" />
              <select value={newTypeCategory} onChange={(e) => setNewTypeCategory(e.target.value)} className="border rounded px-2 py-1">
                <option>None</option>
                <option>Cardio</option>
                <option>Resistance</option>
                <option>Mindfulness</option>
              </select>
              <Button onClick={addType} className="ml-2"><Plus className="mr-2 h-4 w-4"/> Add Type</Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {weekly.customTypes.map((t) => (
                <div key={t} className="flex items-center gap-2 bg-slate-100 px-2 py-1 rounded">
                  <span className="text-sm font-medium">{t}</span>
                  <select value={(weekly.typeCategories||{})[t] || 'None'} onChange={async (e) => {
                    const newCat = e.target.value;
                    const updatedCats = { ...(weekly.typeCategories || {}) } as Record<string,string>;
                    updatedCats[t] = newCat;
                    const updated = { ...weekly, typeCategories: updatedCats } as WeeklyPlan;
                    setWeekly(normalizeWeekly(updated));
                    saveGlobalTypes(updated.customTypes, updatedCats);
                    // open the types panel so users discover categorization
                    setTypesPanelOpen(true);
                    const uid = auth.currentUser?.uid;
                    if (uid) {
                      try { await setDoc(doc(db, 'users', uid, 'settings', 'types'), { categories: updatedCats, types: updated.customTypes }, { merge: true }); } catch (e) { console.warn('Failed to save categories to Firestore', e); }
                    }
                  }} className="text-xs p-1 border rounded">
                    <option>None</option>
                    <option>Cardio</option>
                    <option>Resistance</option>
                    <option>Mindfulness</option>
                  </select>
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
                    {/* session badge removed as requested */}
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
                          onClick={async () => {
                              const days = [...weekly.days];
                              const day = { ...days[idx] };
                              const newTypes = { ...day.types, [t]: !active } as Record<string, boolean>;
                              // Note: do NOT auto-toggle 'Cardio' when Bike is toggled to avoid double-counting.
                              // Cardio totals are computed from category mappings (Bike counts toward Cardio in the header),
                              // but we keep the checkboxes independent so the UI reflects exactly what you checked.
                              console.debug('[WT] toggleType cell', safeString({ type: t, dateISO: days[idx].dateISO, before: day.types, after: newTypes, idx }));
                              day.types = newTypes;

                              // If there are no real session docs for the day, create or remove a manual session doc so DB stays authoritative
                              const uid = auth.currentUser?.uid;
                              const oldList = Array.isArray(day.sessionsList) ? day.sessionsList.slice() : [];
                              const realExists = oldList.some(s => s?.id && !String(s.id).startsWith('manual:'));
                              const hasAny = Object.values(newTypes).some(Boolean);
                              if (!realExists && uid) {
                                try {
                                  if (hasAny) {
                                    // create or update a manual session doc (await to avoid races)
                                    const existingManual = oldList.find(s => s?.id && String(s.id).startsWith('manual:')) as any;
                                    if (!existingManual) {
                                      const payload = { sessionName: 'Manual', sessionTypes: Object.keys(newTypes).filter(k => newTypes[k]), exercises: [], completedAt: Date.now(), dateISO: day.dateISO };
                                      const r = await addDoc(collection(db, 'users', uid, 'sessions'), payload as any);
                                      // use server id returned from addDoc
                                      day.sessionsList = [{ id: r.id, sessionTypes: payload.sessionTypes }];
                                    } else {
                                      // update manual doc on server and use the same id
                                      const ref = doc(db, 'users', uid, 'sessions', existingManual.id);
                                      const updatedTypes = Object.keys(newTypes).filter(k => newTypes[k]);
                                      await setDoc(ref, { sessionTypes: updatedTypes }, { merge: true });
                                      day.sessionsList = [{ id: existingManual.id, sessionTypes: updatedTypes }];
                                    }
                                  } else {
                                    // remove manual session docs for that date if any
                                    try {
                                      const q = query(collection(db, 'users', uid, 'sessions'), where('dateISO', '==', day.dateISO), where('sessionName', '==', 'Manual'));
                                      const snapsToDelete = await getDocs(q);
                                      for (const sdoc of snapsToDelete.docs) {
                                        try { await deleteDoc(doc(db, 'users', uid, 'sessions', sdoc.id)); } catch (e) { /* ignore per-doc failures */ }
                                      }
                                    } catch (e) {
                                      console.warn('[WT] failed to delete server manual sessions', e);
                                    }
                                    // remove any local manual ids from the sessionsList reference
                                    day.sessionsList = [];
                                  }
                                } catch (e) {
                                  console.warn('[WT] toggle persistence failed', e);
                                }
                              } else {
                                // local only fallback
                                if (!hasAny) day.sessionsList = [];
                                else day.sessionsList = [{ id: `manual:${crypto.randomUUID()}`, sessionTypes: Object.keys(newTypes).filter(k => newTypes[k]) }];
                              }

                              day.sessions = (day.sessionsList || []).length;
                              days[idx] = day;
                              const newWeekly = { ...weekly, days } as WeeklyPlan;
                              // update local UI immediately
                              setWeekly(newWeekly);
                              // persist weekly settings (ensure we persist the fresh newWeekly)
                              try { if (uid) await setDoc(doc(db, 'users', uid, 'state', newWeekly.weekOfISO), { weekly: newWeekly }, { merge: true }); } catch (e) { console.warn('[WT] failed to persist weekly after toggle', e); }
                              // No automatic session reconstruction — weekly state is authoritative.
                            }}
                        >
                          {active ? <Check className="inline h-4 w-4" /> : ""}
                        </td>
                      );
                    })}
                    <td className="p-2 border-b font-semibold">
                      {(() => {
                        const n = Math.min(7, counts[t]);
                        return <span>{n} <span className="text-[10px] text-neutral-500">{n === 1 ? 'day' : 'days'}</span></span>;
                      })()}
                    </td>
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
                        <span className="text-[10px] text-neutral-500">{(weekly.benchmarks[t] ?? 0) === 1 ? 'day' : 'days'}</span>
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
  weekly,
  setWeekly,
}: {
  session: ResistanceSession;
  setSession: (s: ResistanceSession) => void;
  weekly: WeeklyPlan;
  setWeekly: (w: WeeklyPlan) => void;
}) {
  const toasts = useToasts();
  const [pendingFavorites, setPendingFavorites] = useState<Set<string>>(new Set());
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSec, setTimerSec] = useState<number>(session.durationSec || 0);
  const [routines, setRoutines] = useState<any[]>([]);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);
  const [sessionFavorited, setSessionFavorited] = useState<boolean>(false);

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

  const completeWorkout = async () => {
    // Prevent double-processing for the same session object
    if (completedGuards.has(session)) {
      console.warn('[WT] completeWorkout called but session already processed', { sessionName: session.sessionName, dateISO: session.dateISO });
      return;
    }
    completedGuards.add(session);

    // Mark session as completed in local state
    setSession({ ...session, completed: true, durationSec: timerSec });

    const today = session.dateISO;
    const todayIndex = weekly.days.findIndex((d) => d.dateISO === today);
    console.debug('[WT] completeWorkout called', safeString({ sessionDate: today, todayIndex, sessionTypes: session.sessionTypes, weeklyDays: weekly.days.map((d) => d.dateISO) }));

    // Persist completed session to Firestore first so we get a document id
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        console.warn('[WT] completeWorkout: no user id, cannot persist session');
      } else {
        const payload = { ...session, durationSec: timerSec, completedAt: Date.now() };
        const docRef = await addDoc(collection(db, 'users', uid, 'sessions'), payload as any);
        const sessionId = docRef.id;

        if (todayIndex !== -1) {
          const updatedDays = [...weekly.days];
          const markTypes: string[] = [...session.sessionTypes];
          // if Bike is present, also mark Cardio implicitly
          if (markTypes.includes('Bike') && !markTypes.includes('Cardio')) markTypes.push('Cardio');
          const newTypes = { ...updatedDays[todayIndex].types } as Record<string, boolean>;
          markTypes.forEach((t) => { newTypes[t] = true; });
          const before = { ...updatedDays[todayIndex].types, sessions: updatedDays[todayIndex].sessions };
          // push a session record (with id) into sessionsList (authoritative list of sessions)
          const oldList = Array.isArray(updatedDays[todayIndex].sessionsList) ? updatedDays[todayIndex].sessionsList.slice() : [];
          oldList.push({ id: sessionId, sessionTypes: markTypes });
          const after = { ...newTypes, sessions: oldList.length };
          console.debug('[WT] Updating day types and sessionsList', safeString({ dateISO: updatedDays[todayIndex].dateISO, before, after, markTypes, sessionsListBefore: updatedDays[todayIndex].sessionsList }));
          updatedDays[todayIndex] = { ...updatedDays[todayIndex], types: newTypes, sessions: after.sessions, sessionsList: oldList };
          const newWeekly = { ...weekly, days: updatedDays } as WeeklyPlan;
          setWeekly(newWeekly);
          // Persist weekly immediately so sessionsList is saved server-side
          try {
            await setDoc(doc(db, 'users', uid, 'state', newWeekly.weekOfISO), { weekly: newWeekly }, { merge: true });
            console.debug('[WT] persisted weekly after completeWorkout', safeString({ uid, week: newWeekly.weekOfISO }));
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
    // leave the guard true to prevent re-entry
  };

  // Save current session as a routine/template (no results)
  const saveRoutine = async () => {
    try {
      const uid = auth.currentUser?.uid;
      const payload = {
        id: crypto.randomUUID(),
        name: session.sessionName || 'Routine',
        exercises: session.exercises.map((e) => ({ id: e.id, name: e.name, minSets: e.minSets, targetReps: e.targetReps })),
        sessionTypes: session.sessionTypes,
        createdAt: Date.now(),
      };
      if (!uid) {
        // save locally
        saveLocalRoutine(payload);
  toasts.push('Routine saved locally', 'success');
        return;
      }
      const ref = collection(db, 'users', uid, 'routines');
      await addDoc(ref, payload as any);
  toasts.push('Routine saved', 'success');
    } catch (e) {
      console.error('Save routine failed', e);
  toasts.push('Save failed', 'error');
    }
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
                      const payload = { name: session.sessionName || 'Routine', exercises: session.exercises.map(e=>({ name: e.name, minSets: e.minSets, targetReps: e.targetReps })), sessionTypes: session.sessionTypes || [], createdAt: Date.now(), public: false, owner: uid, ownerName: auth.currentUser?.displayName || auth.currentUser?.email || uid };
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
        <Button variant="secondary" onClick={saveRoutine}>
          <Save className="mr-2 h-4 w-4"/> Save Routine
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

function HistoryView({ weekly, setWeekly }: { weekly: WeeklyPlan; setWeekly: (w: WeeklyPlan) => void }) {
  const toasts = useToasts();
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
              <div className="flex items-center gap-2">
                <div className="text-sm text-neutral-600">{(it.exercises || []).length} exercises</div>
                <Button variant="destructive" onClick={async () => {
                  if (!confirm('Delete this session?')) return;
                  try {
                    const uid = auth.currentUser?.uid; if (!uid) return toasts.push('Sign in to delete', 'info');
                    await deleteDoc(doc(db, 'users', uid, 'sessions', it.id));
                    // remove from local weekly state
                    const days = weekly.days.map(d => ({ ...d, sessionsList: (d.sessionsList || []).filter(s => s.id !== it.id) }));
                    const newWeekly = normalizeWeekly({ ...weekly, days } as WeeklyPlan);
                    setWeekly(newWeekly);
                    // remove from history list
                    setItems(prev => prev.filter(x => x.id !== it.id));
                  } catch (e) {
                    console.error('Delete session failed', e);
                    toasts.push('Delete failed - see console', 'error');
                  }
                }}>Delete</Button>
              </div>
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

function LibraryView({ onLoadRoutine }: { onLoadRoutine: (s: ResistanceSession, mode?: 'replace'|'append') => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const toasts = useToasts();
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<any | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  // Composer / scratchpad state
  const [composerName, setComposerName] = useState('');
  const [composerExercises, setComposerExercises] = useState<ResistanceExercise[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [composerKind, setComposerKind] = useState<'routine'|'exercise'>('routine');
  const [composerPublic, setComposerPublic] = useState(false);
  const [composerFavorite, setComposerFavorite] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all'|'exercise'|'workout'|'type'|'user'>('all');
  const [filterQuery, setFilterQuery] = useState('');
  const [pendingFavorites, setPendingFavorites] = useState<Set<string>>(new Set());

  const resetComposer = () => { setComposerName(''); setComposerExercises([]); setEditingId(null); };

  const addComposerExercise = () => setComposerExercises(prev => [...prev, { id: crypto.randomUUID(), name: 'New exercise', minSets: 3, targetReps: 8, sets: [0,0,0] }]);

  const saveComposerAsRoutine = async () => {
    try {
      setSaveMessage(null);
      const uid = auth.currentUser?.uid;
      const userName = auth.currentUser?.displayName || auth.currentUser?.email || uid || 'local';
      if (composerKind === 'routine' && !composerName) { setSaveMessage('Name the routine'); return; }
      if (composerKind === 'exercise' && composerExercises.length === 0) { setSaveMessage('Add at least one exercise'); return; }
      if (!uid) { setSaveMessage('Sign in to save routines and exercises to the global library'); return; }
      // Signed-in: persist to Firestore
      
        // Signed-in: persist to Firestore
        if (composerKind === 'exercise') {
          const ref = collection(db, 'users', uid, 'exercises');
          const createdIds: string[] = [];
          for (const ex of composerExercises) {
            const payload = { name: ex.name, minSets: ex.minSets, targetReps: ex.targetReps, createdAt: Date.now(), public: composerPublic, owner: uid, ownerName: userName };
            const docRef = await addDoc(ref, payload as any);
            createdIds.push(docRef.id);
          }
          // If user checked Favorite, add per-user favorites for each created exercise
          if (composerFavorite && createdIds.length > 0) {
            for (const id of createdIds) {
              const favId = `exercise::${id}`;
              try { await setDoc(doc(db, 'users', uid, 'favorites', favId), { itemType: 'exercise', itemId: id, createdAt: Date.now() }); } catch (e) { console.warn('Failed to favorite created exercise', e); }
            }
          }
          setSaveMessage('Saved exercise(s)');
        } else {
          const payload = { name: composerName, exercises: composerExercises.map(e => ({ name: e.name, minSets: e.minSets, targetReps: e.targetReps })), sessionTypes: [], createdAt: Date.now(), public: composerPublic, owner: uid, ownerName: userName };
          const ref = collection(db, 'users', uid, 'routines');
            if (editingId) {
            await setDoc(doc(db, 'users', uid, 'routines', editingId), payload, { merge: true });
            // if favoriting an edited item, ensure favorite exists or is toggled
            if (composerFavorite) {
              const favId = `routine::${editingId}`;
              try { await setDoc(doc(db, 'users', uid, 'favorites', favId), { itemType: 'routine', itemId: editingId, createdAt: Date.now() }); } catch (e) { console.warn('Failed to favorite edited routine', e); }
            }
              setSaveMessage('Updated routine');
          } else {
            const docRef = await addDoc(ref, payload as any);
            if (composerFavorite) {
              const favId = `routine::${docRef.id}`;
              try { await setDoc(doc(db, 'users', uid, 'favorites', favId), { itemType: 'routine', itemId: docRef.id, createdAt: Date.now() }); } catch (e) { console.warn('Failed to favorite created routine', e); }
            }
              setSaveMessage('Saved routine');
          }
        }
      await loadList();
      resetComposer();
      setTimeout(() => setSaveMessage(null), 3000);
  } catch (e) { console.error('Save composer failed', e); setSaveMessage('Save failed'); setTimeout(()=>setSaveMessage(null),3000); }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        // Not signed in: surface public items only so the library isn't empty
        let data: any[] = [];
        try {
          if (filter === 'exercise') {
            const cg = query(collectionGroup(db, 'exercises'), where('public', '==', true));
            const publicSnaps = await getDocs(cg);
            data = publicSnaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: d.ref.parent.parent?.id || 'unknown', kind: 'exercise' }));
          } else {
            const cg = query(collectionGroup(db, 'routines'), where('public', '==', true));
            const publicSnaps = await getDocs(cg);
            data = publicSnaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: d.ref.parent.parent?.id || 'unknown', kind: 'routine' }));
          }
        } catch (e) { console.warn('Failed to load public items', e); }
        setItems(data.sort((a,b)=> (b.createdAt||0)-(a.createdAt||0)));
        setLoading(false);
        return;
      }
      let data: any[] = [];
      if (filter === 'exercise') {
        // load exercises
        const ref = collection(db, 'users', uid, 'exercises');
        const snaps = await getDocs(ref);
        data = snaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: uid, kind: 'exercise' }));
        // include public exercises from other users
        try {
          const cg = query(collectionGroup(db, 'exercises'), where('public', '==', true));
          const publicSnaps = await getDocs(cg);
          const pub = publicSnaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: d.ref.parent.parent?.id || 'unknown', kind: 'exercise' }));
          for (const p of pub) if (p.owner !== uid) data.push(p);
        } catch (e) { console.warn('Failed to load public exercises', e); }
      } else {
        // load user's routines
        const ref = collection(db, 'users', uid, 'routines');
        const snaps = await getDocs(ref);
        data = snaps.docs.map((d) => ({ id: d.id, ...(d.data() as any), owner: uid, kind: 'routine' }));
        // also load public routines from other users (collection group)
        try {
          const cg = query(collectionGroup(db, 'routines'), where('public', '==', true));
          const publicSnaps = await getDocs(cg);
          const pub = publicSnaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: d.ref.parent.parent?.id || 'unknown', kind: 'routine' }));
          for (const p of pub) if (p.owner !== uid) data.push(p);
        } catch (e) {
          console.warn('Failed to load public routines collectionGroup', e);
        }
      }
      // annotate with whether current user favorited each item (favorites stored per-user)
      // annotate with whether current user favorited each item (only when signed in)
      try {
        const favSnaps = await getDocs(collection(db, 'users', uid, 'favorites'));
        const favs = favSnaps.docs.map(d => d.data() as any);
        const favSet = new Set(favs.map((f:any)=> `${f.itemType||'routine'}::${f.itemId}`));
        // write to global cache
        (window as any).__app_favorites_cache.map = favSet;
        data = data.map(it => ({ ...it, favorite: favSet.has(`${it.kind||'routine'}::${it.id}`) }));
      } catch (e) {
        console.warn('Failed to load favorites for user', e);
      }
      // basic filtering
      if (filter !== 'all') {
        if (filter === 'exercise') data = data.filter(it => (it.name||it.exercises?.map((e:any)=>e.name).join(' ')||'').toLowerCase().includes(filterQuery.toLowerCase()));
        if (filter === 'workout') data = data.filter(it => (it.name||'').toLowerCase().includes(filterQuery.toLowerCase()));
        if (filter === 'type') data = data.filter(it => (it.sessionTypes||[]).some((t:string)=> t.toLowerCase().includes(filterQuery.toLowerCase())));
        if (filter === 'user') data = data.filter(it => ((it.ownerName||it.owner)||'').toLowerCase().includes(filterQuery.toLowerCase()));
      }
      setItems(data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    } catch (e) {
      console.error('Load routines list failed', e);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadList(); }, [filter]);

  // keep favorites in sync in real-time for signed-in user
  useEffect(() => {
    let unsub: any = null;
    let mounted = true;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      // subscribe to favorites collection and update items' favorite flags
      const col = collection(db, 'users', uid, 'favorites');
      unsub = (async () => {
        const onSnap = (await import('firebase/firestore')).onSnapshot as any;
        return onSnap(col, (snap: any) => {
          try {
            const favSet = new Set<string>();
            snap.docs.forEach((d: any) => {
              const data = d.data();
              favSet.add(`${data.itemType||'routine'}::${data.itemId}`);
            });
            (window as any).__app_favorites_cache.map = favSet;
            if (!mounted) return;
            setItems(prev => prev.map(it => ({ ...it, favorite: favSet.has(`${it.kind||'routine'}::${it.id}`) })));
          } catch (e) { console.warn('favorites snapshot handler failed', e); }
        });
      })();
    } catch (e) {
      console.warn('Failed to subscribe to favorites', e);
    }
    return () => { mounted = false; if (unsub && typeof unsub === 'function') unsub(); };
  }, []);

  return (
    <div className="space-y-3">
      {/* Composer */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Routine Builder</div>
                <div className="text-xs text-neutral-600">Create routines or single exercises and save to your library</div>
            </div>
            <div className="flex gap-2">
                <select value={composerKind} onChange={(e)=>setComposerKind(e.target.value as any)} className="border rounded px-2 py-1">
                  <option value="routine">Workout (routine)</option>
                  <option value="exercise">Single exercise</option>
                </select>
                <label className="flex items-center gap-2"><input type="checkbox" checked={composerPublic} onChange={(e)=>setComposerPublic(e.target.checked)} /> Public</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={composerFavorite} onChange={(e)=>setComposerFavorite(e.target.checked)} /> Favorite</label>
                <Button variant="outline" onClick={resetComposer}>Clear</Button>
                <Button onClick={saveComposerAsRoutine}>Save</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <Input placeholder="Routine name" value={composerName} onChange={(e) => setComposerName(e.target.value)} />
            {saveMessage && (
              <div className="text-sm text-green-600 mt-2">{saveMessage}</div>
            )}
            <div className="space-y-2">
              {composerExercises.map((ex, idx) => (
                <div key={ex.id} className="flex gap-2 items-center">
                  <Input value={ex.name} onChange={(e) => setComposerExercises(prev => { const c = [...prev]; c[idx] = { ...c[idx], name: e.target.value }; return c; })} />
                  <Input type="number" value={String(ex.minSets)} onChange={(e) => setComposerExercises(prev => { const c = [...prev]; c[idx] = { ...c[idx], minSets: Math.max(1, parseInt(e.target.value||'1')) }; return c; })} className="w-20" />
                  <Input type="number" value={String(ex.targetReps)} onChange={(e) => setComposerExercises(prev => { const c = [...prev]; c[idx] = { ...c[idx], targetReps: Math.max(1, parseInt(e.target.value||'1')) }; return c; })} className="w-20" />
                  <Button variant="destructive" onClick={() => setComposerExercises(prev => prev.filter(p => p.id !== ex.id))}>Remove</Button>
                </div>
              ))}
              <Button onClick={addComposerExercise}>Add exercise</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="flex items-center gap-2">
        <select value={filter} onChange={(e)=>setFilter(e.target.value as any)} className="border rounded px-2 py-1">
          <option value="all">All</option>
          <option value="exercise">Exercise</option>
          <option value="workout">Workout</option>
          <option value="type">Type</option>
          <option value="user">User</option>
        </select>
  <Input placeholder="filter query" value={filterQuery} onChange={(e)=>setFilterQuery(e.target.value)} />
        <Button variant="outline" onClick={() => loadList()}>Filter</Button>
      </div>

      {loading ? (
        <div>Loading routines...</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-neutral-600">No routines yet. Use the Routine Builder above to add exercises or workouts.</div>
      ) : (
        items.map((it) => (
        <Card key={it.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{it.name}</div>
                <div className="text-xs text-neutral-600">{(it.exercises || []).length} exercises</div>
                <div className="text-xs text-neutral-500">{it.public ? 'Public' : 'Private'} {it.ownerName ? <span className="block text-[10px] text-neutral-400">{it.ownerName}</span> : it.owner ? <span className="block text-[10px] text-neutral-400">{it.owner}</span> : null}</div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => {
                  const exercises = (it.exercises || []).map((e: any) => ({ id: crypto.randomUUID(), name: e.name, minSets: e.minSets, targetReps: e.targetReps, sets: Array(e.minSets).fill(0) }));
                  onLoadRoutine({ dateISO: toISO(new Date()), sessionName: it.name, exercises, completed: false, sessionTypes: it.sessionTypes || [], durationSec: 0, sourceTemplateId: it.id });
                }}>Load</Button>
                <Button onClick={() => {
                  const exercises = (it.exercises || []).map((e: any) => ({ id: crypto.randomUUID(), name: e.name, minSets: e.minSets, targetReps: e.targetReps, sets: Array(e.minSets).fill(0) }));
                  onLoadRoutine({ dateISO: toISO(new Date()), sessionName: it.name, exercises, completed: false, sessionTypes: it.sessionTypes || [], durationSec: 0, sourceTemplateId: it.id }, 'append');
                }} title="Append to current session">Append</Button>
                <Button variant="outline" onClick={async ()=>{
                  const uid = auth.currentUser?.uid; if (!uid) return toasts.push('Sign in', 'info');
                  const itemType = (it.kind||'routine');
                  const favId = `${itemType}::${it.id}`;
                  if (pendingFavorites.has(favId)) return; // noop while pending
                  // optimistic UI: update local state and remember previous state for rollback
                  const prev = items;
                  const initial = !!it.favorite;
                  const optimistic = prev.map(p => p.id === it.id ? { ...p, favorite: !initial } : p);
                  setItems(optimistic);
                  setPendingFavorites(prev => new Set(prev).add(favId));
                  try {
                    const favRef = doc(db, 'users', uid, 'favorites', favId);
                    const favSnap = await getDoc(favRef);
                    if (favSnap.exists()) {
                      await deleteDoc(favRef);
                      toasts.push('Removed favorite', 'success');
                    } else {
                      await setDoc(favRef, { itemType, itemId: it.id, createdAt: Date.now() });
                      toasts.push('Favorited', 'success');
                    }
                    // update shared cache
                    try {
                      const cur: Set<string> = (window as any).__app_favorites_cache.map || new Set();
                      const newSet = new Set(cur);
                      if (initial) newSet.delete(favId); else newSet.add(favId);
                      (window as any).__app_favorites_cache.map = newSet;
                    } catch (e) { /* ignore cache failures */ }
                  } catch (e) {
                    console.error('Toggle fav failed', e);
                    // rollback optimistic change
                    setItems(prev);
                    toasts.push('Failed to toggle favorite', 'error');
                  } finally {
                    setPendingFavorites(prev => { const n = new Set(prev); n.delete(favId); return n; });
                  }
                }} title="Toggle favorite" disabled={pendingFavorites.has(`${it.kind||'routine'}::${it.id}`)}>
                  <Bookmark className={cn('h-4 w-4', it.favorite && 'text-yellow-500')} />
                </Button>
                <Button variant="outline" onClick={() => { setRenameTarget(it); setRenameValue(it.name); setShowRenameModal(true); }}>Rename</Button>
                <Button variant="destructive" onClick={() => { setDeleteTarget(it); setShowDeleteModal(true); }}>Delete</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-sm">{(it.sessionTypes || []).join(', ')}</div>
          </CardContent>
        </Card>
        ))
      )}
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
                  const uid = auth.currentUser?.uid; if (!uid) { setSaveMessage('Sign in'); setTimeout(()=>setSaveMessage(null),2000); return; }
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
                  const uid = auth.currentUser?.uid; if (!uid) { setSaveMessage('Sign in'); setTimeout(()=>setSaveMessage(null),2000); return; }
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
