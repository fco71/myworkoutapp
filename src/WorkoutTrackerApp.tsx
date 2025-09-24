import { useMemo, useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { doc, getDoc, setDoc, collection, addDoc, getDocs, deleteDoc, query, where, collectionGroup } from "firebase/firestore";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Check, Save, Bookmark, Edit, Search, Dumbbell, User, Grid3X3, Target } from "lucide-react";
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
    benchmarks: { Bike: 3, "Row Machine": 3, "Piano Practice": 4, Mindfulness: 3 },
  customTypes: ["Bike", "Row Machine", "Piano Practice", "Mindfulness"],
  typeCategories: { Bike: 'Cardio', "Row Machine": 'Cardio', "Piano Practice": 'Skills', Mindfulness: 'Mindfulness' },
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
  <WeeklyTracker weekly={weekly} setWeekly={setWeekly} push={appToasts.push} />
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
              
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>
              
              <div className="grid gap-2">
                <Button
                  variant="outline"
                  className="w-full bg-white hover:bg-gray-50 border-gray-300 text-gray-700 font-medium py-3"
                  onClick={async () => {
                    try {
                      const provider = new GoogleAuthProvider();
                      await signInWithPopup(auth, provider);
                      setShowSignIn(false);
                      setEmail("");
                      setPassword("");
                      setIsSignUp(false);
                    } catch (e) {
                      console.error("Google auth failed:", e);
                    }
                  }}
                >
                  <svg className="mr-3 h-5 w-5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC04"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  <span className="text-sm">Continue with Google</span>
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
  push,
}: {
  weekly: WeeklyPlan;
  setWeekly: (w: WeeklyPlan) => void;
  push?: (text: string, kind?: 'info'|'success'|'error') => void;
}) {
  const types = weekly.customTypes;
  const [typesPanelOpen, setTypesPanelOpen] = useState(false);
  const [editTypeModal, setEditTypeModal] = useState<{ type: string; name: string; category: string } | null>(null);

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

      {/* Edit Type Modal */}
      {editTypeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Edit Workout Type</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Type Name</label>
                <Input 
                  value={editTypeModal.name} 
                  onChange={(e) => setEditTypeModal({ ...editTypeModal, name: e.target.value })} 
                  placeholder="Enter type name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Category</label>
                <select 
                  value={editTypeModal.category} 
                  onChange={(e) => setEditTypeModal({ ...editTypeModal, category: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="None">None</option>
                  <option value="Cardio">Cardio</option>
                  <option value="Resistance">Resistance</option>
                  <option value="Mindfulness">Mindfulness</option>
                  <option value="Skills">Skills</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditTypeModal(null)}>Cancel</Button>
                <Button onClick={() => {
                  const originalType = editTypeModal.type;
                  const newName = editTypeModal.name.trim();
                  const newCategory = editTypeModal.category;
                  
                  if (!newName) return;
                  
                  const newBenchmarks = { ...weekly.benchmarks };
                  const newCustomTypes = [...(weekly.customTypes || [])];
                  const newCategories = { ...weekly.typeCategories };
                  
                  if (newName !== originalType) {
                    // Name changed - transfer benchmark and update all references
                    newBenchmarks[newName] = newBenchmarks[originalType] || 0;
                    delete newBenchmarks[originalType];
                    
                    // Update custom types
                    const idx = newCustomTypes.indexOf(originalType);
                    if (idx >= 0) newCustomTypes[idx] = newName;
                    
                    // Update all day types
                    const newDays = weekly.days.map(d => {
                      if (d.types[originalType]) {
                        const newTypes = { ...d.types };
                        newTypes[newName] = true;
                        delete newTypes[originalType];
                        return { ...d, types: newTypes };
                      }
                      return d;
                    });
                    
                    // Update categories
                    newCategories[newName] = newCategory;
                    delete newCategories[originalType];
                    
                    setWeekly({ ...weekly, days: newDays, benchmarks: newBenchmarks, customTypes: newCustomTypes, typeCategories: newCategories });
                  } else {
                    // Only category changed
                    newCategories[originalType] = newCategory;
                    setWeekly({ ...weekly, typeCategories: newCategories });
                  }
                  
                  setEditTypeModal(null);
                }}>Save Changes</Button>
              </div>
            </div>
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
                    <td className="sticky left-0 bg-white p-2 font-medium border-b">
                      <div className="flex items-center justify-between">
                        <span className={hit ? 'text-green-700' : ''}>{t}</span>
                        <div className="flex gap-1 opacity-60 hover:opacity-100">
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-5 w-5 p-0 hover:bg-blue-100" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditTypeModal({
                                type: t,
                                name: t,
                                category: weekly.typeCategories?.[t] || 'None'
                              });
                            }}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-5 w-5 p-0 hover:bg-red-100" 
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Remove "${t}" type and all its data?`)) {
                                const newBenchmarks = { ...weekly.benchmarks };
                                delete newBenchmarks[t];
                                const newCustomTypes = weekly.customTypes?.filter(ct => ct !== t) || [];
                                const newCategories = { ...weekly.typeCategories };
                                delete newCategories[t];
                                // Remove from all days
                                const newDays = weekly.days.map(d => {
                                  const newTypes = { ...d.types };
                                  delete newTypes[t];
                                  return { ...d, types: newTypes };
                                });
                                setWeekly({ ...weekly, days: newDays, benchmarks: newBenchmarks, customTypes: newCustomTypes, typeCategories: newCategories });
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </td>
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
        { id: crypto.randomUUID(), name: "", minSets: 3, targetReps: 6, sets: [0, 0, 0] },
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
            placeholder="New exercise"
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
  // Initialize favorites cache on component mount
  useEffect(() => {
    // Clear any stale cache from previous sessions
    (window as any).__app_favorites_cache = { map: new Set() };
  }, []);

  const [filter, setFilter] = useState<'all'|'exercise'|'workout'|'type'|'user'|'favorites'>('all');
  const [filterQuery, setFilterQuery] = useState('');
  const [pendingFavorites, setPendingFavorites] = useState<Set<string>>(new Set());

  const resetComposer = () => { setComposerName(''); setComposerExercises([]); setEditingId(null); };

  const addComposerExercise = () => setComposerExercises(prev => [...prev, { id: crypto.randomUUID(), name: '', minSets: 3, targetReps: 8, sets: [0,0,0] }]);

  const editRoutine = (routine: any) => {
    // Only allow editing routines (not individual exercises) and only if user owns them
    const uid = auth.currentUser?.uid;
    if (!uid || routine.owner !== uid || (routine.kind && routine.kind !== 'routine')) return;
    
    // Populate composer with routine data
    setComposerName(routine.name);
    setComposerExercises((routine.exercises || []).map((e: any) => ({
      id: crypto.randomUUID(),
      name: e.name,
      minSets: e.minSets,
      targetReps: e.targetReps,
      sets: Array(e.minSets).fill(0)
    })));
    setEditingId(routine.id);
    setComposerKind('routine');
    setComposerPublic(!!routine.public);
    setComposerFavorite(!!routine.favorite);
  };

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
      console.log('[Library] Loading list, uid:', uid, 'filter:', filter);
      if (!uid) {
        // Not signed in: load public content only so new users can see the shared library
        console.log('[Library] Not signed in, loading public content only');
        let data: any[] = [];
        try {
          const cgEx = query(collectionGroup(db, 'exercises'), where('public', '==', true));
          const publicExSnaps = await getDocs(cgEx);
          const pubEx = publicExSnaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: d.ref.parent.parent?.id || 'unknown', kind: 'exercise' }));
          data = [...data, ...pubEx];
          
          const cgRt = query(collectionGroup(db, 'routines'), where('public', '==', true));
          const publicRtSnaps = await getDocs(cgRt);
          const pubRt = publicRtSnaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: d.ref.parent.parent?.id || 'unknown', kind: 'routine' }));
          data = [...data, ...pubRt];
          
          console.log('Unsigned user loaded', pubEx.length, 'public exercises and', pubRt.length, 'public routines');
        } catch (e) {
          console.error('Failed to load public content for unsigned user - INDEX ERROR:', e);
        }
        
        // Apply favorites filter (will be empty for unsigned users)
        data = data.map(it => ({ ...it, favorite: false }));
        if (filter === 'favorites') {
          data = []; // No favorites for unsigned users
        }
        
        console.log('[Library] Final setItems call with', data.length, 'items');
        const sortedData = data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setItems(sortedData);
        setLoading(false);
        return;
      }
      
      let data: any[] = [];
      
      if (filter === 'exercise') {
        // Load standalone exercises
        const ref = collection(db, 'users', uid, 'exercises');
        const snaps = await getDocs(ref);
        data = snaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: uid, kind: 'exercise' }));
        
        // Extract individual exercises from user's routines
        const routinesRef = collection(db, 'users', uid, 'routines');
        const routineSnaps = await getDocs(routinesRef);
        routineSnaps.docs.forEach(d => {
          const routine = d.data() as any;
          (routine.exercises || []).forEach((ex: any) => {
            data.push({
              id: `${d.id}_${ex.name}`, // unique id for extracted exercise
              name: ex.name,
              minSets: ex.minSets,
              targetReps: ex.targetReps,
              kind: 'exercise',
              owner: uid,
              parentRoutine: routine.name,
              public: routine.public || false,
              createdAt: routine.createdAt
            });
          });
        });
        
        // Include public exercises from other users
        try {
          const cg = query(collectionGroup(db, 'exercises'), where('public', '==', true));
          const publicSnaps = await getDocs(cg);
          const pub = publicSnaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: d.ref.parent.parent?.id || 'unknown', kind: 'exercise' }));
          for (const p of pub) if (p.owner !== uid) data.push(p);
          
          // Also get exercises from public routines
          const cgRoutines = query(collectionGroup(db, 'routines'), where('public', '==', true));
          const publicRoutineSnaps = await getDocs(cgRoutines);
          publicRoutineSnaps.docs.forEach(d => {
            if ((d.ref.parent.parent?.id || 'unknown') !== uid) {
              const routine = d.data() as any;
              (routine.exercises || []).forEach((ex: any) => {
                data.push({
                  id: `${d.id}_${ex.name}`,
                  name: ex.name,
                  minSets: ex.minSets,
                  targetReps: ex.targetReps,
                  kind: 'exercise',
                  owner: d.ref.parent.parent?.id || 'unknown',
                  parentRoutine: routine.name,
                  public: true,
                  createdAt: routine.createdAt
                });
              });
            }
          });
        } catch (e) { console.warn('Failed to load public exercises', e); }
        
      } else if (filter === 'workout') {
        // Load only workout routines (not individual exercises)
        const ref = collection(db, 'users', uid, 'routines');
        const snaps = await getDocs(ref);
        data = snaps.docs.map((d) => ({ id: d.id, ...(d.data() as any), owner: uid, kind: 'routine' }));
        
        // Also load public routines from other users
        try {
          const cg = query(collectionGroup(db, 'routines'), where('public', '==', true));
          const publicSnaps = await getDocs(cg);
          const pub = publicSnaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: d.ref.parent.parent?.id || 'unknown', kind: 'routine' }));
          for (const p of pub) if (p.owner !== uid) data.push(p);
        } catch (e) {
          console.warn('Failed to load public routines', e);
        }
        
      } else if (filter === 'user') {
        // Load only user's own content
        const refEx = collection(db, 'users', uid, 'exercises');
        const snapsEx = await getDocs(refEx);
        const exercises = snapsEx.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: uid, kind: 'exercise' }));
        
        const refRt = collection(db, 'users', uid, 'routines');
        const snapsRt = await getDocs(refRt);
        const routines = snapsRt.docs.map((d) => ({ id: d.id, ...(d.data() as any), owner: uid, kind: 'routine' }));
        
        data = [...exercises, ...routines];
        
      } else {
        // Load all content (both routines and standalone exercises)
        const refEx = collection(db, 'users', uid, 'exercises');
        const snapsEx = await getDocs(refEx);
        data = snapsEx.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: uid, kind: 'exercise' }));
        
        const refRt = collection(db, 'users', uid, 'routines');
        const snapsRt = await getDocs(refRt);
        const routines = snapsRt.docs.map((d) => ({ id: d.id, ...(d.data() as any), owner: uid, kind: 'routine' }));
        data = [...data, ...routines];
        
        // Also load public content from other users
        try {
          const cgEx = query(collectionGroup(db, 'exercises'), where('public', '==', true));
          const publicExSnaps = await getDocs(cgEx);
          const pubEx = publicExSnaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: d.ref.parent.parent?.id || 'unknown', kind: 'exercise' }));
          for (const p of pubEx) if (p.owner !== uid) data.push(p);
          
          const cgRt = query(collectionGroup(db, 'routines'), where('public', '==', true));
          const publicRtSnaps = await getDocs(cgRt);
          const pubRt = publicRtSnaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: d.ref.parent.parent?.id || 'unknown', kind: 'routine' }));
          for (const p of pubRt) if (p.owner !== uid) data.push(p);
          console.log('Successfully loaded', pubEx.length, 'public exercises and', pubRt.length, 'public routines');
        } catch (e) {
          console.error('Failed to load public content - this is the index error:', e);
        }
      }
      // Favorites will be handled by the real-time listener to prevent race conditions
      // Initialize items with favorite: false, the listener will update them
      data = data.map(it => ({ ...it, favorite: false }));
      
      // For favorites filter, filter by favorited items
      if (filter === 'favorites') {
        const currentFavs = (window as any).__app_favorites_cache?.map || new Set();
        data = data.filter(it => currentFavs.has(`${it.kind||'routine'}::${it.id}`));
      }
      console.log('[Library] Final setItems call with', data.length, 'items');
      const sortedData = data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setItems(sortedData);
    } catch (e) {
      console.error('Load routines list failed', e);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadList(); }, [filter]);

  // keep favorites in sync in real-time for signed-in user
  useEffect(() => {
    let unsub: any = null;
    let mounted = true;
    let updateTimeout: number | null = null;
    const uid = auth.currentUser?.uid;
    if (!uid) {
      // Clear favorites for unsigned users and reset items to prevent blinking
      (window as any).__app_favorites_cache = { map: new Set() };
      setItems([]);
      return;
    }
    
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
            
            // Only update cache and items if something actually changed
            const currentCache = (window as any).__app_favorites_cache?.map;
            const hasChanged = !currentCache || 
              favSet.size !== currentCache.size || 
              Array.from(favSet).some(item => !currentCache.has(item));
              
            if (!hasChanged) return;
            
            (window as any).__app_favorites_cache.map = favSet;
            if (!mounted) return;
            
            // Debounce updates and only apply if items exist
            if (updateTimeout) clearTimeout(updateTimeout);
            updateTimeout = setTimeout(() => {
              setItems(prev => {
                if (prev.length === 0) return prev; // Don't update empty lists to prevent blinking
                return prev.map(it => ({ ...it, favorite: favSet.has(`${it.kind||'routine'}::${it.id}`) }));
              });
            }, 150);
          } catch (e) { console.warn('favorites snapshot handler failed', e); }
        });
      })();
    } catch (e) {
      console.warn('Failed to subscribe to favorites', e);
    }
    return () => { 
      mounted = false; 
      if (updateTimeout) clearTimeout(updateTimeout);
      if (unsub && typeof unsub === 'function') unsub(); 
    };
  }, [auth.currentUser?.uid]); // React to auth changes

  return (
    <div className="space-y-3">
      {/* Modern Routine Builder */}
      <Card className="bg-gradient-to-br from-slate-50 to-blue-50 border-blue-100 shadow-lg">
        <CardHeader className="bg-white/50 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className={cn(
                  "p-2 rounded-lg",
                  editingId ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"
                )}>
                  {editingId ? <Edit className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </div>
                <h2 className="font-bold text-xl text-gray-900">
                  {editingId ? 'Edit Routine' : 'Routine Builder'}
                </h2>
              </div>
              <p className="text-sm text-gray-600">
                {editingId ? 'Editing existing routine' : 'Create routines or single exercises and save to your library'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <select 
                  value={composerKind} 
                  onChange={(e)=>setComposerKind(e.target.value as any)} 
                  className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="routine">Workout (routine)</option>
                  <option value="exercise">Single exercise</option>
                </select>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={composerPublic} 
                    onChange={(e)=>setComposerPublic(e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-white border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                  /> 
                  <span className="text-gray-700">Public</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={composerFavorite} 
                    onChange={(e)=>setComposerFavorite(e.target.checked)}
                    className="w-4 h-4 text-yellow-600 bg-white border-gray-300 rounded focus:ring-yellow-500 focus:ring-2"
                  /> 
                  <span className="text-gray-700">Favorite</span>
                </label>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={resetComposer} size="sm" className="hover:bg-gray-50">
                  Clear
                </Button>
                <Button 
                  onClick={saveComposerAsRoutine} 
                  size="sm"
                  className={cn(
                    "shadow-sm",
                    editingId 
                      ? "bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700"
                      : "bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
                  )}
                >
                  {editingId ? 'Update' : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Input 
              placeholder={composerKind === 'routine' ? "Routine name (e.g., Upper Body Strength)" : "Exercise name"}
              value={composerName} 
              onChange={(e) => setComposerName(e.target.value)}
              className="text-lg font-medium bg-white border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          
          {saveMessage && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <Check className="h-4 w-4 text-green-600" />
              <span className="text-sm text-green-700 font-medium">{saveMessage}</span>
            </div>
          )}
          
          <div className="space-y-3">
            {composerExercises.map((ex, idx) => (
              <div key={ex.id} className="flex gap-3 items-center p-3 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
                <div className="flex-1">
                  <Input 
                    value={ex.name} 
                    placeholder="New exercise" 
                    onChange={(e) => setComposerExercises(prev => { const c = [...prev]; c[idx] = { ...c[idx], name: e.target.value }; return c; })}
                    className="font-medium border-0 bg-transparent p-0 focus:ring-0"
                  />
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span>Sets:</span>
                  <Input 
                    type="number" 
                    value={String(ex.minSets)} 
                    onChange={(e) => setComposerExercises(prev => { const c = [...prev]; c[idx] = { ...c[idx], minSets: Math.max(1, parseInt(e.target.value||'1')) }; return c; })} 
                    className="w-16 text-center border-gray-200"
                  />
                  <span>Reps:</span>
                  <Input 
                    type="number" 
                    value={String(ex.targetReps)} 
                    onChange={(e) => setComposerExercises(prev => { const c = [...prev]; c[idx] = { ...c[idx], targetReps: Math.max(1, parseInt(e.target.value||'1')) }; return c; })} 
                    className="w-16 text-center border-gray-200"
                  />
                </div>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setComposerExercises(prev => prev.filter(p => p.id !== ex.id))}
                  className="text-gray-400 hover:text-red-500 hover:bg-red-50 shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button 
              onClick={addComposerExercise} 
              variant="outline" 
              className="w-full border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 text-gray-600 hover:text-blue-600"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Exercise
            </Button>
          </div>
        </CardContent>
      </Card>
      {/* Modern Filter Interface */}
      <div className="space-y-4">
        {/* Category Tabs */}
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'all', label: 'All Items', icon: Grid3X3 },
            { key: 'workout', label: 'Workouts', icon: Dumbbell },
            { key: 'exercise', label: 'Exercises', icon: Target },
            { key: 'user', label: 'My Content', icon: User },
            { key: 'favorites', label: 'Favorites', icon: Bookmark },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => {setFilter(key as any); loadList();}}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
                filter === key
                  ? "bg-blue-100 text-blue-700 shadow-md"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:shadow-sm"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        
        {/* Modern Search Bar */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input 
            placeholder="Search workouts and exercises..." 
            value={filterQuery} 
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && loadList()}
            className="pl-10 bg-white border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-200 rounded-lg"></div>
                    <div className="space-y-2">
                      <div className="w-32 h-4 bg-gray-200 rounded"></div>
                      <div className="w-24 h-3 bg-gray-200 rounded"></div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="w-16 h-8 bg-gray-200 rounded"></div>
                    <div className="w-20 h-8 bg-gray-200 rounded"></div>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
                <Dumbbell className="h-8 w-8 text-gray-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">No workouts yet</h3>
                <p className="text-gray-600 max-w-sm">
                  Start building your workout library using the Routine Builder above, or browse public workouts from other users.
                </p>
              </div>
              <Button 
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Workout
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        items.map((it) => (
        <Card key={it.id} className="group hover:shadow-lg transition-all duration-300 border-0 bg-gradient-to-br from-white to-gray-50 hover:from-blue-50 hover:to-indigo-50">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <div className={cn(
                    "p-2 rounded-lg shrink-0",
                    (it.kind === 'exercise' || it.exercises?.length === 1) 
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-blue-100 text-blue-700"
                  )}>
                    {(it.kind === 'exercise' || it.exercises?.length === 1) 
                      ? <Dumbbell className="h-4 w-4" />
                      : <Grid3X3 className="h-4 w-4" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg text-gray-900 truncate group-hover:text-blue-900 transition-colors">
                      {it.name}
                    </h3>
                    <div className="flex items-center gap-4 mt-1">
                      {it.kind === 'exercise' && !it.parentRoutine ? (
                        <span className="text-sm text-gray-600 flex items-center gap-1">
                          <Target className="h-3 w-3" />
                          {it.minSets || 3} sets × {it.targetReps || 8} reps
                        </span>
                      ) : it.kind === 'exercise' && it.parentRoutine ? (
                        <span className="text-sm text-gray-600 flex items-center gap-1">
                          <Target className="h-3 w-3" />
                          {it.minSets || 3} sets × {it.targetReps || 8} reps
                        </span>
                      ) : (
                        <span className="text-sm text-gray-600 flex items-center gap-1">
                          <Plus className="h-3 w-3" />
                          {(it.exercises || []).length} exercises
                        </span>
                      )}
                      {it.parentRoutine && (
                        <span className="inline-flex items-center px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                          from {it.parentRoutine}
                        </span>
                      )}
                      {it.favorite && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full">
                          <Bookmark className="h-3 w-3 fill-current" />
                          Favorite
                        </span>
                      )}
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full",
                        it.public 
                          ? "bg-green-100 text-green-700" 
                          : "bg-gray-100 text-gray-600"
                      )}>
                        {it.public ? 'Public' : 'Private'}
                      </span>
                    </div>
                  </div>
                </div>
                {it.ownerName && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                    <User className="h-3 w-3" />
                    {it.ownerName}
                  </div>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                {/* Only show Load/Append for full routines, not individual exercises */}
                {it.kind === 'routine' ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-blue-600 uppercase tracking-wide">Full Workout Routine</div>
                    <div className="flex gap-2">
                      <Button 
                        size="sm"
                        onClick={() => {
                          const exercises = (it.exercises || []).map((e: any) => ({ id: crypto.randomUUID(), name: e.name, minSets: e.minSets, targetReps: e.targetReps, sets: Array(e.minSets).fill(0) }));
                          onLoadRoutine({ dateISO: toISO(new Date()), sessionName: it.name, exercises, completed: false, sessionTypes: it.sessionTypes || [], durationSec: 0, sourceTemplateId: it.id });
                        }}
                        className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-sm"
                        title="Replace current workout with this routine"
                      >
                        <Grid3X3 className="h-3 w-3 mr-1" />
                        Start This Workout
                      </Button>
                      <Button 
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const exercises = (it.exercises || []).map((e: any) => ({ id: crypto.randomUUID(), name: e.name, minSets: e.minSets, targetReps: e.targetReps, sets: Array(e.minSets).fill(0) }));
                          onLoadRoutine({ dateISO: toISO(new Date()), sessionName: it.name, exercises, completed: false, sessionTypes: it.sessionTypes || [], durationSec: 0, sourceTemplateId: it.id }, 'append');
                        }} 
                        title="Add all exercises from this routine to current workout"
                        className="border-blue-200 text-blue-600 hover:bg-blue-50 hover:border-blue-300"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add All Exercises
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-emerald-600 uppercase tracking-wide">Single Exercise</div>
                    <div className="flex gap-2">
                      <Button 
                        size="sm"
                        onClick={() => {
                          // For individual exercises, add them to current session
                          const exercise = { id: crypto.randomUUID(), name: it.name, minSets: it.minSets || 3, targetReps: it.targetReps || 8, sets: Array(it.minSets || 3).fill(0) };
                          onLoadRoutine({ dateISO: toISO(new Date()), sessionName: 'Current Session', exercises: [exercise], completed: false, sessionTypes: [], durationSec: 0 }, 'append');
                        }}
                        className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-sm"
                        title="Add this single exercise to your current workout"
                      >
                        <Target className="h-3 w-3 mr-1" />
                        Add Exercise
                      </Button>
                    </div>
                  </div>
                )}
                
                <div className="flex gap-1">
                  {/* Edit button - only show for routines owned by current user */}
                  {auth.currentUser?.uid && it.owner === auth.currentUser.uid && it.kind === 'routine' && (
                    <Button 
                      size="sm"
                      variant="ghost" 
                      onClick={() => editRoutine(it)} 
                      title="Edit routine"
                      className="text-gray-600 hover:text-blue-600 hover:bg-blue-50"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  )}
                  
                  <Button 
                    size="sm"
                    variant="ghost" 
                    onClick={async ()=>{
                  const uid = auth.currentUser?.uid; if (!uid) return toasts.push('Sign in', 'info');
                  const itemType = (it.kind||'routine');
                  const favId = `${itemType}::${it.id}`;
                  if (pendingFavorites.has(favId)) return; // noop while pending
                  // optimistic UI: update local state and remember previous state for rollback
                  const prev = items;
                  const initial = !!it.favorite;
                  const optimistic = prev.map(p => p.id === it.id ? { ...p, favorite: !initial } : p);
                  setItems(optimistic);
                  setPendingFavorites(prevPending => new Set(prevPending).add(favId));
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
                    setPendingFavorites(prevPending => { const n = new Set(prevPending); n.delete(favId); return n; });
                  }
                }} title="Toggle favorite" disabled={pendingFavorites.has(`${it.kind||'routine'}::${it.id}`)}
                    className={cn(
                      "hover:bg-yellow-50",
                      it.favorite ? "text-yellow-500 hover:text-yellow-600" : "text-gray-400 hover:text-yellow-500"
                    )}
                  >
                    <Bookmark className={cn('h-4 w-4', it.favorite && 'fill-current')} />
                  </Button>
                  
                  {/* Show rename/delete only for owned items */}
                  {auth.currentUser?.uid && it.owner === auth.currentUser.uid && (
                    <>
                      <Button 
                        size="sm"
                        variant="ghost" 
                        onClick={() => { setRenameTarget(it); setRenameValue(it.name); setShowRenameModal(true); }}
                        className="text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                        title="Rename"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        size="sm"
                        variant="ghost" 
                        onClick={() => { setDeleteTarget(it); setShowDeleteModal(true); }}
                        className="text-gray-400 hover:text-red-500 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Only show session types for routines that actually have session types */}
            {it.kind === 'routine' && (it.sessionTypes || []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(it.sessionTypes || []).map((type: string, idx: number) => (
                  <span key={idx} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                    {type}
                  </span>
                ))}
              </div>
            )}
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
