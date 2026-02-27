import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { User, ChevronDown, Settings, LogOut } from "lucide-react";
import { ToastContainer } from "@/components/ui/toast";
import { WeeklyPlan, ResistanceSession, PersistedState } from "@/types";
import {
  defaultWeekly,
  defaultSession,
  getMonday,
  toISO,
  weekDates,
  arraysEqual,
  ensureUniqueTypes,
  normalizeWeekly,
  loadGlobalTypes,
  loadTypeCategories,
  createEmptyWeek,
  useToasts,
} from "@/lib/workout-utils";
import { initializeAudio, playBeep } from "@/lib/audio";
import { WeeklyOverview } from "@/components/WeeklyOverview";
import { WeeklyBenchmarkStack } from "@/components/WeeklyBenchmarkStack";
import { WeeklyTracker } from "@/components/WeeklyTracker";
import { WorkoutView } from "@/components/WorkoutView";
import { HistoryView } from "@/components/HistoryView";
import { LibraryView } from "@/components/LibraryView";

// Expose Firebase objects globally for console access
(window as any).appAuth = auth;
(window as any).appDb = db;

export default function WorkoutTrackerApp() {
  const [weekly, setWeekly] = useState<WeeklyPlan>(defaultWeekly());

  const [previousWeeks, setPreviousWeeks] = useState<WeeklyPlan[]>([]);
  const [programStartDate, setProgramStartDate] = useState<string>('2025-09-22'); // Start date of current program
  const [session, setSession] = useState<ResistanceSession>(defaultSession());
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [tempUsername, setTempUsername] = useState('');
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);

  // Request notification permissions on app initialization
  useEffect(() => {
    // Request notification permission for timer alarms
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Username and profile management
  const updateUsername = async (newUsername: string) => {
    if (!userId || !newUsername.trim()) return;
    try {
      const profileRef = doc(db, 'users', userId, 'profile', 'info');
      await setDoc(profileRef, { username: newUsername.trim() }, { merge: true });
      setUserName(newUsername.trim());
      setEditingUsername(false);
      appToasts.push('Username updated', 'success');
    } catch (e) {
      console.error('Failed to update username:', e);
      appToasts.push('Failed to update username', 'error');
    }
  };
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // top-level toasts container for non-blocking messages
  const appToasts = useToasts();
  // (celebration UI removed per user request)

  // Handle sign in function for Enter key support
  const handleSignIn = async () => {
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
      appToasts.push('Sign in failed', 'error');
    }
  };

  // keep a global favorites snapshot map to keep optimistic updates reconciled across components
  // This will be populated via a listener when a user signs in (see effect below in child components)
  // Exposed via a simple ref-like object pattern (we attach to window for quick debug in dev)
  // Note: we don't persist anything here; this is an app-level cache to avoid stale optimistic UI.
  (window as any).__app_favorites_cache = (window as any).__app_favorites_cache || { map: new Set<string>() };

  // Offline cache is configured at Firestore initialization in lib/firebase

  // Auth + initial load
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (u) {
          setUserId(u.uid);
          // Load username from Firestore profile, fallback to display name or default
          try {
            const profileRef = doc(db, 'users', u.uid, 'profile', 'info');
            const profileSnap = await getDoc(profileRef);
            if (profileSnap.exists() && profileSnap.data().username) {
              const loadedUsername = profileSnap.data().username;
              setUserName(loadedUsername);
            } else {
              // No username set yet, use display name as default and save it
              const defaultUsername = u.displayName || u.email?.split('@')[0] || 'User';
              setUserName(defaultUsername);
              await setDoc(profileRef, { username: defaultUsername, email: u.email }, { merge: true });
            }
          } catch (e) {
            console.warn('Failed to load username, using fallback:', e);
            const fallbackUsername = u.displayName || u.email?.split('@')[0] || 'User';
            setUserName(fallbackUsername);
          }
          // Load program start date FIRST so week number and previous weeks use the correct value (not stale state)
          let loadedProgramStartDate = programStartDate;
          try {
            const programRef = doc(db, 'users', u.uid, 'settings', 'program');
            const pSnap = await getDoc(programRef);
            if (pSnap.exists()) {
              const data = pSnap.data() as any;
              if (data?.programStartDate) {
                loadedProgramStartDate = data.programStartDate;
                setProgramStartDate(data.programStartDate);
              }
            }
          } catch (e) {
            console.warn('[WT] Failed to load program settings first', e);
          }
          // Prefer per-week document keyed by weekOfISO. Fall back to the legacy 'tracker' doc.
          try {
            const currentMonday = getMonday();
            const currentWeekISO = toISO(currentMonday);
            const weekRef = doc(db, 'users', u.uid, 'state', currentWeekISO);
            const wSnap = await getDoc(weekRef);
            if (wSnap.exists()) {
              const data = wSnap.data() as PersistedState;
              if (data?.weekly) {
                // Validate that the stored weekOfISO is actually a Monday
                const storedWeekISO = data.weekly.weekOfISO;
                const storedDate = new Date(storedWeekISO + 'T00:00:00');
                const storedDayOfWeek = storedDate.getDay();

                // If stored weekOfISO is not a Monday (day 1), fix it
                if (storedDayOfWeek !== 1) {
                  console.warn('[WT] Stored weekOfISO is not a Monday!', {
                    stored: storedWeekISO,
                    dayOfWeek: storedDayOfWeek,
                    shouldBe: currentWeekISO
                  });
                  // Force use the correctly calculated Monday
                  data.weekly.weekOfISO = currentWeekISO;
                }

                // dedupe types and normalize
                const uniq = ensureUniqueTypes(data.weekly.customTypes || []);
                let normalized = normalizeWeekly({ ...data.weekly, customTypes: uniq, weekOfISO: currentWeekISO } as WeeklyPlan);

                // Ensure days array matches current week dates
                const currentWeekDates = weekDates(currentMonday).map(d => toISO(d));
                const existingDates = normalized.days.map(d => d.dateISO);

                if (!arraysEqual(currentWeekDates, existingDates)) {
                  // Create new days array with current week dates, preserving existing data where possible
                  const newDays = currentWeekDates.map(dateISO => {
                    const existingDay = normalized.days.find(d => d.dateISO === dateISO);
                    return existingDay || {
                      dateISO,
                      types: {},
                      sessions: 0,
                      sessionsList: [],
                      comments: {}
                    };
                  });
                  normalized = { ...normalized, days: newDays };
                }

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
                      // persist reconstructed weekly so subsequent loads use sessionsList
                      // Persist reconstructed weekly removed per app decision (weekly doc is authoritative)
                    }
                  } catch (e) {
                    console.warn('[WT] Failed to reconstruct sessionsList from sessions collection', e);
                  }
                  setWeekly(normalized);

                  // Load multiple previous weeks for benchmark display
                  try {
                    const prevWeeksData: WeeklyPlan[] = [];
                    const currentMonday = getMonday();

                    // Load all previous weeks since program start (no limit)
                    const startDate = new Date(loadedProgramStartDate + 'T00:00:00');
                    const startMonday = getMonday(startDate);
                    const currentWeekNumber = Math.floor((currentMonday.getTime() - startMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
                    // Always load at least 12 previous weeks so history is never empty (even when "Week 1")
                    const weeksToLoad = Math.max(currentWeekNumber - 1, 12);

                    // Get customTypes from current week to use for empty weeks
                    const currentCustomTypes = normalized.customTypes || [];
                    const currentTypeCategories = normalized.typeCategories || {};

                    for (let i = 1; i <= weeksToLoad; i++) {
                      const prevMonday = new Date(currentMonday);
                      prevMonday.setDate(currentMonday.getDate() - (7 * i)); // Go back i weeks
                      const prevMondayISO = toISO(prevMonday);


                      const prevWeekRef = doc(db, 'users', u.uid, 'state', prevMondayISO);
                      const prevSnap = await getDoc(prevWeekRef);

                      if (prevSnap.exists()) {
                        const prevData = prevSnap.data() as PersistedState;

                        if (prevData?.weekly) {
                          const prevUniq = ensureUniqueTypes(prevData.weekly.customTypes || []);
                          const prevNormalized = normalizeWeekly({ ...prevData.weekly, customTypes: prevUniq } as WeeklyPlan);
                          prevWeeksData.push(prevNormalized);
                        } else {
                          // Document exists but no weekly data - create empty week structure
                          const emptyWeek = createEmptyWeek(prevMonday, currentCustomTypes, currentTypeCategories);
                          prevWeeksData.push(emptyWeek);
                        }
                      } else {
                        // No document exists - create empty week structure so all weeks show in history
                        const emptyWeek = createEmptyWeek(prevMonday, currentCustomTypes, currentTypeCategories);
                        prevWeeksData.push(emptyWeek);
                      }
                    }

                    // Sort by date descending (most recent first) then assign sequential week numbers
                    prevWeeksData.sort((a, b) => new Date(b.weekOfISO).getTime() - new Date(a.weekOfISO).getTime());

                    // Assign week numbers to previous weeks based on their date (already calculated above)
                    prevWeeksData.forEach((weekData) => {
                      const weekMonday = new Date(weekData.weekOfISO + 'T00:00:00');
                      weekData.weekNumber = Math.floor((weekMonday.getTime() - startMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
                    });

                    // Update current week number
                    setWeekly(prev => ({ ...prev, weekNumber: currentWeekNumber }));

                    setPreviousWeeks(prevWeeksData);
                  } catch (e) {
                    console.warn('[WT] Failed to load previous weeks data', e);
                    // Do not clear previousWeeks on error - avoids wiping history on transient failures
                  }
              }
              if (data?.session) setSession(data.session);
            } else {

              // Try to load previous week's benchmarks automatically
              const prevMonday = new Date(currentMonday);
              prevMonday.setDate(currentMonday.getDate() - 7);
              const prevISO = toISO(prevMonday);

              let benchmarksFromPrevWeek = {};
              let customTypesFromPrevWeek: string[] = [];

              try {
                const prevWeekRef = doc(db, 'users', u.uid, 'state', prevISO);
                const prevSnap = await getDoc(prevWeekRef);
                if (prevSnap.exists()) {
                  const prevData = prevSnap.data() as PersistedState;
                  if (prevData?.weekly) {
                    benchmarksFromPrevWeek = prevData.weekly.benchmarks || {};
                    customTypesFromPrevWeek = prevData.weekly.customTypes || [];
                  }
                }
              } catch (e) {
                console.warn('[WT] Failed to auto-copy from previous week:', e);
              }

              // Check legacy tracker doc as fallback
              const ref = doc(db, "users", u.uid, "state", "tracker");
              const snap = await getDoc(ref);
              if (snap.exists()) {
                const data = snap.data() as PersistedState;
                if (data?.weekly) {
                  // Apply same week correction logic as current week loading
                  const normalized = normalizeWeekly({
                    ...data.weekly,
                    benchmarks: Object.keys(benchmarksFromPrevWeek).length > 0 ? benchmarksFromPrevWeek : data.weekly.benchmarks,
                    customTypes: customTypesFromPrevWeek.length > 0 ? ensureUniqueTypes(customTypesFromPrevWeek) : ensureUniqueTypes(data.weekly.customTypes || []),
                    weekOfISO: currentWeekISO // Force current week ISO
                  } as WeeklyPlan);

                  // Ensure days array matches current week dates
                  const currentWeekDates = weekDates(currentMonday).map(d => toISO(d));
                  const existingDates = normalized.days.map(d => d.dateISO);

                  if (!arraysEqual(currentWeekDates, existingDates)) {
                    // Create new days array with current week dates, preserving existing data where possible
                    const newDays = currentWeekDates.map(dateISO => {
                      const existingDay = normalized.days.find(d => d.dateISO === dateISO);
                      return existingDay || {
                        dateISO,
                        types: {},
                        sessions: 0,
                        sessionsList: [],
                        comments: {}
                      };
                    });
                    normalized.days = newDays;
                  }

                  setWeekly(normalized);
                }
                if (data?.session) setSession(data.session);
              } else {
                const defaultWk = defaultWeekly();
                // Apply auto-copied benchmarks and types if available
                if (Object.keys(benchmarksFromPrevWeek).length > 0 || customTypesFromPrevWeek.length > 0) {
                  defaultWk.benchmarks = benchmarksFromPrevWeek;
                  defaultWk.customTypes = customTypesFromPrevWeek;
                }
                setWeekly(defaultWk);

                // Save the new week with auto-copied benchmarks to Firestore
                if (Object.keys(benchmarksFromPrevWeek).length > 0 || customTypesFromPrevWeek.length > 0) {
                  try {
                    await setDoc(doc(db, 'users', u.uid, 'state', currentWeekISO), {
                      weekly: {
                        benchmarks: benchmarksFromPrevWeek,
                        customTypes: customTypesFromPrevWeek
                      }
                    }, { merge: true });
                  } catch (e) {
                    console.warn('[WT] Failed to auto-save benchmarks:', e);
                  }
                }
              }
              // Load previous weeks when current week doc was missing, so history is never empty
              try {
                const startDate = new Date(loadedProgramStartDate + 'T00:00:00');
                const startMonday = getMonday(startDate);
                const currentWeekNumber = Math.max(1, Math.floor((currentMonday.getTime() - startMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1);
                const weeksToLoad = Math.max(currentWeekNumber - 1, 12);
                const currentCustomTypes = customTypesFromPrevWeek.length > 0 ? customTypesFromPrevWeek : loadGlobalTypes();
                const currentTypeCategories = loadTypeCategories();
                const prevWeeksData: WeeklyPlan[] = [];
                for (let i = 1; i <= weeksToLoad; i++) {
                  const weekMonday = new Date(currentMonday);
                  weekMonday.setDate(currentMonday.getDate() - (7 * i));
                  const prevWeekRef = doc(db, 'users', u.uid, 'state', toISO(weekMonday));
                  const prevSnap = await getDoc(prevWeekRef);
                  if (prevSnap.exists()) {
                    const prevData = prevSnap.data() as PersistedState;
                    if (prevData?.weekly) {
                      const prevUniq = ensureUniqueTypes(prevData.weekly.customTypes || []);
                      prevWeeksData.push(normalizeWeekly({ ...prevData.weekly, customTypes: prevUniq } as WeeklyPlan));
                    } else {
                      prevWeeksData.push(createEmptyWeek(weekMonday, currentCustomTypes, currentTypeCategories));
                    }
                  } else {
                    prevWeeksData.push(createEmptyWeek(weekMonday, currentCustomTypes, currentTypeCategories));
                  }
                }
                prevWeeksData.sort((a, b) => new Date(b.weekOfISO).getTime() - new Date(a.weekOfISO).getTime());
                prevWeeksData.forEach((weekData) => {
                  const weekMonday = new Date(weekData.weekOfISO + 'T00:00:00');
                  weekData.weekNumber = Math.floor((weekMonday.getTime() - startMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
                });
                setPreviousWeeks(prevWeeksData);
                setWeekly(prev => ({ ...prev, weekNumber: currentWeekNumber }));
              } catch (e) {
                console.warn('[WT] Failed to load previous weeks (no current week path)', e);
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
                  // Only apply global types to weekly state if the weekly has no custom types yet
                  setWeekly((prev) => {
                    if (prev.customTypes && prev.customTypes.length > 0) return prev;
                    return normalizeWeekly({ ...prev, customTypes: custom, typeCategories: { ...(prev.typeCategories || {}), ...(cats || {}) } } as WeeklyPlan);
                  });
              } else if (cats && Object.keys(cats).length > 0) {
                  // if only categories present, merge into weekly (never overwrite existing categories blindly)
                  setWeekly((prev) => {
                    const updated = { ...prev, typeCategories: { ...(prev.typeCategories || {}), ...(cats || {}) } } as WeeklyPlan;
                    return normalizeWeekly(updated);
                  });
              }
            }
          } catch (e) {
            console.warn('Failed to load settings/types from Firestore', e);
          }
          // load program settings (start date)
          try {
            const programRef = doc(db, 'users', u.uid, 'settings', 'program');
            const pSnap = await getDoc(programRef);
            if (pSnap.exists()) {
              const data = pSnap.data() as any;
              if (data?.programStartDate) setProgramStartDate(data.programStartDate);
            }
          } catch (e) {
            console.warn('Failed to load program settings from Firestore', e);
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

  // Initialize audio context on user interaction
  useEffect(() => {
    const handleUserInteraction = () => {
      initializeAudio();
      // Remove listeners after first interaction
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);
      document.removeEventListener('touchstart', handleUserInteraction);
    };

    // Add event listeners for user interaction
    document.addEventListener('click', handleUserInteraction);
    document.addEventListener('keydown', handleUserInteraction);
    document.addEventListener('touchstart', handleUserInteraction);

    // Cleanup
    return () => {
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);
      document.removeEventListener('touchstart', handleUserInteraction);
    };
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

  // Global floating countdown timer
  const LS_COUNTDOWN = 'workout:last_countdown_sec';

  // Initialize with last used value from localStorage
  const [countdownSec, setCountdownSec] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(LS_COUNTDOWN);
      if (raw) {
        const v = parseInt(raw || '0');
        if (!isNaN(v) && v > 0) return v;
      }
    } catch (e) { /* ignore */ }
    return 90; // Default to 1:30
  });
  const [countdownRunning, setCountdownRunning] = useState(false);
  const [showCountdownModal, setShowCountdownModal] = useState(false);

  useEffect(() => {
    if (!countdownRunning) return;
    const id = setInterval(() => {
      setCountdownSec((s) => {
        if (s <= 1) {
          setCountdownRunning(false);
          playBeep();
          // Restore to saved preference when timer finishes
          try {
            const raw = localStorage.getItem(LS_COUNTDOWN);
            if (raw) {
              const saved = parseInt(raw);
              if (!isNaN(saved) && saved > 0) {
                return saved;
              }
            }
          } catch (e) { /* ignore */ }
          return 90; // Default to 1:30 if no saved preference
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [countdownRunning]);

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
            </div>
            <div className="flex gap-2">
              {userId ? (
                <>
                  {/* User Dropdown Menu */}
                  <div className="relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowUserDropdown(!showUserDropdown)}
                      className="flex items-center gap-2 text-slate-700 hover:text-slate-900 hover:bg-slate-50"
                    >
                      <User className="h-4 w-4" />
                      <span className="hidden sm:inline">{userName || "User"}</span>
                      <ChevronDown className="h-3 w-3" />
                    </Button>

                    {showUserDropdown && (
                      <>
                        {/* Backdrop to close dropdown when clicking outside */}
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setShowUserDropdown(false)}
                        />

                        {/* Dropdown Menu */}
                        <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg border border-slate-200 shadow-lg z-20">
                          <div className="py-2">
                            {/* Profile Section */}
                            <div className="px-4 py-2 border-b border-slate-100">
                              <p className="text-sm font-medium text-slate-900">{userName || "User"}</p>
                              <p className="text-xs text-slate-500">{auth.currentUser?.email}</p>
                            </div>

                            {/* Settings Option */}
                            <button
                              onClick={() => {
                                setTempUsername(userName || '');
                                setEditingUsername(true);
                                setShowUserDropdown(false);
                              }}
                              className="w-full px-4 py-2 text-sm text-left text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                            >
                              <Settings className="h-4 w-4" />
                              Edit Profile
                            </button>

                            {/* Log Out Option */}
                            <button
                              onClick={() => {
                                setShowUserDropdown(false);
                                signOut(auth);
                              }}
                              className="w-full px-4 py-2 text-sm text-left text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                            >
                              <LogOut className="h-4 w-4" />
                              Log out
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Username Edit Modal */}
                  {editingUsername && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                      <div className="bg-white rounded-lg p-6 w-full max-w-sm">
                        <h3 className="text-lg font-semibold mb-4">Edit Profile</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium mb-2">Username</label>
                            <Input
                              value={tempUsername}
                              onChange={(e) => setTempUsername(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  updateUsername(tempUsername);
                                } else if (e.key === 'Escape') {
                                  setEditingUsername(false);
                                  setTempUsername('');
                                }
                              }}
                              placeholder="Enter your username"
                              autoFocus
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setEditingUsername(false);
                                setTempUsername('');
                              }}
                            >
                              Cancel
                            </Button>
                            <Button onClick={() => updateUsername(tempUsername)}>
                              Save
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
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
          <WeeklyOverview weekly={weekly} previousWeeks={previousWeeks} />
        </header>

        <Tabs defaultValue="week" className="">
          <TabsList className="grid grid-cols-4 w-full md:w-auto bg-white/80 backdrop-blur-sm border border-slate-200 shadow-sm">
            <TabsTrigger value="week" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">Weekly Tracker</TabsTrigger>
            <TabsTrigger value="workout" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">Workout Session</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">History</TabsTrigger>
            <TabsTrigger value="library" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">Library</TabsTrigger>
          </TabsList>

      <TabsContent value="week" className="mt-4">
        <WeeklyTracker
          weekly={weekly}
          setWeekly={setWeekly}
          push={appToasts.push}
          programStartDate={programStartDate}
          setProgramStartDate={setProgramStartDate}
          previousWeeks={previousWeeks}
        />

        {/* Weekly Benchmark Stack - Previous weeks as collapsible benchmark charts */}
        <WeeklyBenchmarkStack
          previousWeeks={previousWeeks}
          onUpdateWeek={async (week) => {
            try {
              if (!userId) {
                console.error('No user ID available');
                return;
              }

              // Save the updated week to Firebase - Clean undefined values
              const cleanWeek = JSON.parse(JSON.stringify(week, (_key, value) => {
                return value === undefined ? null : value;
              }));

              const weekRef = doc(db, 'users', userId, 'state', week.weekOfISO);
              await setDoc(weekRef, { weekly: cleanWeek });

              // Update local state to reflect changes
              setPreviousWeeks(prev => {
                const updated = prev.map(w => w.weekOfISO === week.weekOfISO ? week : w);
                return updated;
              });

            } catch (error) {
              console.error('Error saving week:', error);
            }
          }}
        />
      </TabsContent>

          <TabsContent value="workout" className="mt-4">
            <WorkoutView session={session} setSession={setSession} weekly={weekly} setWeekly={setWeekly} userName={userName} />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <HistoryView weekly={weekly} setWeekly={setWeekly} setSession={setSession} previousWeeks={previousWeeks} />
          </TabsContent>

          <TabsContent value="library" className="mt-4">
            <LibraryView userName={userName} onLoadRoutine={(r, mode) => {
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
            <button
              className={`w-12 h-12 rounded-full text-white flex items-center justify-center shadow-lg transition-all duration-300 ${
                countdownRunning && countdownSec <= 10
                  ? 'bg-red-600 animate-pulse scale-125'
                  : countdownRunning
                    ? 'bg-orange-600 scale-115'
                    : 'bg-blue-600'
              }`}
              onClick={() => setShowCountdownModal(true)}
            >
              <span className={`transition-all duration-300 ${
                countdownRunning && countdownSec <= 10
                  ? 'text-3xl'
                  : countdownRunning
                    ? 'text-2xl'
                    : 'text-xl'
              }`}>
                ⏱️
              </span>
            </button>
            {countdownRunning && (
              <div className={`absolute -top-2 -right-2 text-white text-xs rounded-full px-2 py-0.5 ${
                countdownSec <= 10 ? 'bg-red-600 animate-pulse' : 'bg-red-600'
              }`}>
                {Math.floor(countdownSec/60)}:{String(countdownSec%60).padStart(2,'0')}
              </div>
            )}
          </div>
        </div>

        {/* Countdown modal */}
        {showCountdownModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50">
            <div className="bg-white p-6 rounded-lg w-full max-w-md">
              <h3 className="text-lg font-semibold mb-2">Set countdown</h3>
              <div className="flex gap-2 items-center mb-3">
                <label className="text-sm font-medium">Minutes:</label>
                <Input
                  type="number"
                  placeholder="0"
                  min="0"
                  max="59"
                  className="w-20"
                  value={Math.floor(countdownSec/60)}
                  onChange={(e) => {
                    if (!countdownRunning) {
                      const minutes = Math.max(0, Math.min(59, parseInt(e.target.value||'0')));
                      const newValue = minutes * 60 + (countdownSec%60);
                      setCountdownSec(newValue);
                      try { localStorage.setItem(LS_COUNTDOWN, String(newValue)); } catch (e) {}
                    }
                  }}
                  disabled={countdownRunning}
                />
                <label className="text-sm font-medium">Seconds:</label>
                <Input
                  type="number"
                  placeholder="0"
                  min="0"
                  max="59"
                  className="w-20"
                  value={countdownSec%60}
                  onChange={(e) => {
                    if (!countdownRunning) {
                      const seconds = Math.min(59, Math.max(0, parseInt(e.target.value||'0')));
                      const newValue = Math.floor(countdownSec/60)*60 + seconds;
                      setCountdownSec(newValue);
                      try { localStorage.setItem(LS_COUNTDOWN, String(newValue)); } catch (e) {}
                    }
                  }}
                  disabled={countdownRunning}
                />
              </div>
              <div className="flex gap-2 mt-3 flex-wrap">
                {[30,60,90,120,180].map(s => (
                  <Button key={s} variant="outline" onClick={() => { setCountdownSec(s); try { localStorage.setItem(LS_COUNTDOWN, String(s)); } catch (e) {} }} className="flex-shrink-0">{`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}</Button>
                ))}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => { setShowCountdownModal(false); }}>Close</Button>
                {!countdownRunning ? (
                  <Button onClick={() => { if (countdownSec>0) { try { localStorage.setItem(LS_COUNTDOWN, String(countdownSec)); } catch (e) {} setCountdownRunning(true); } setShowCountdownModal(false); }}>Start</Button>
                ) : (
                  <Button variant="destructive" onClick={() => {
                    setCountdownRunning(false);
                    // Restore preferred timer value from localStorage
                    try {
                      const raw = localStorage.getItem(LS_COUNTDOWN);
                      if (raw) {
                        const saved = parseInt(raw);
                        if (!isNaN(saved) && saved > 0) {
                          setCountdownSec(saved);
                        }
                      }
                    } catch (e) { /* ignore */ }
                    setShowCountdownModal(false);
                  }}>Stop</Button>
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && email && password) {
                    e.preventDefault();
                    handleSignIn();
                  }
                }}
              />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && email && password) {
                    e.preventDefault();
                    handleSignIn();
                  }
                }}
              />
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={handleSignIn}
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
