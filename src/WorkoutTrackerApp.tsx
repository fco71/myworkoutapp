import { useMemo, useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { doc, getDoc, setDoc, collection, addDoc, getDocs, deleteDoc, query, where, collectionGroup, orderBy } from "firebase/firestore";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Check, Save, Bookmark, Edit, Search, Dumbbell, User, Grid3X3, Target, ChevronDown, ChevronRight, Settings, LogOut, MessageSquare } from "lucide-react";
import { ToastContainer } from "@/components/ui/toast";

// Expose Firebase objects globally for console access
(window as any).appAuth = auth;
(window as any).appDb = db;

// --- Types ---
type ResistanceExercise = {
  id: string;
  name: string;
  minSets: number;
  targetReps: number;
  intensity: number;
  sets: number[];
  notes: string;
};

type ResistanceSession = {
  id?: string;
  dateISO: string;
  sessionName: string;
  exercises: ResistanceExercise[];
  completed: boolean;
  sessionTypes: string[];
  durationSec: number;
  completedAt?: number;
  ts?: number;
  sourceTemplateId?: string;
};

type WeeklyDay = {
  dateISO: string;
  types: Record<string, boolean>;
  sessions: number;
  sessionsList: any[];
  comments: Record<string, string>;
};

type WeeklyPlan = {
  weekOfISO: string;
  weekNumber: number;
  days: WeeklyDay[];
  benchmarks: Record<string, number>;
  customTypes: string[];
  typeCategories: Record<string, string>;
};

// --- Utility Functions ---
// --- Utility Functions ---
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

function getMonday(date?: Date): Date {
  const d = date ? new Date(date) : new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  return new Date(d.setDate(diff));
}

function toISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((val, index) => val === b[index]);
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
    comments: {},
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
    return { 
      ...d, 
      types, 
      sessions: typeof d.sessions === 'number' ? d.sessions : (sessionsList.length || 0), 
      sessionsList,
      comments: d.comments || {} // Ensure comments object exists
    };
  });
  return { ...w, customTypes, benchmarks, days };
}

// Play three progressive beeps using WebAudio API
// Global audio context for better browser compatibility
let globalAudioContext: AudioContext | null = null;
let audioInitialized = false;

function getAudioContext(): AudioContext | null {
  if (!globalAudioContext) {
    try {
      globalAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.warn('Could not create AudioContext:', e);
      return null;
    }
  }
  return globalAudioContext;
}

// Initialize audio on first user interaction
function initializeAudio() {
  if (audioInitialized) return;
  
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().then(() => {
      console.log('Audio context resumed successfully');
      audioInitialized = true;
    }).catch((e) => {
      console.warn('Failed to resume audio context:', e);
    });
  } else if (ctx) {
    audioInitialized = true;
  }
}

async function playBeep() {
  console.log('Timer finished - attempting to play alarm sound');
  try {
    const ctx = getAudioContext();
    if (!ctx) throw new Error('No audio context available');
    
    // Resume context if suspended (required by modern browsers)
    if (ctx.state === 'suspended') {
      console.log('Audio context suspended, attempting to resume...');
      await ctx.resume();
      console.log('Audio context resumed');
    }
    
    // Create four beeps with consistent system volume
    const delays = [0, 200, 400, 600]; // Start times in milliseconds
    
    delays.forEach((delay) => {
      setTimeout(() => {
        try {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          
          // Configure oscillator
          o.type = 'sine';
          o.frequency.value = 880; // A5 note
          o.connect(g);
          g.connect(ctx.destination);
          // Use system volume - no artificial volume reduction
          g.gain.value = 1.0;
          
          // Play short burst
          o.start();
          setTimeout(() => { 
            try {
              o.stop();
            } catch (e) {
              // Ignore if already stopped
            }
          }, 150); // Short 150ms burst
        } catch (e) {
          console.warn('Individual beep failed:', e);
        }
      }, delay);
    });
    
    console.log('Timer beep played successfully');
  } catch (e) {
    console.warn('WebAudio failed, trying HTML5 Audio fallback:', e);
    // Enhanced fallback: try HTML5 Audio with multiple beeps
    try { 
      console.log('Attempting HTML5 Audio fallback...');
      const audioURL = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmkiBUAAfwA=';
      
      // Play multiple beeps to match WebAudio version
      const delays = [0, 200, 400, 600];
      delays.forEach((delay) => {
        setTimeout(() => {
          const audio = new Audio(audioURL);
          // Use system volume - no artificial volume reduction
          audio.play().then(() => {
            console.log(`HTML5 Audio beep ${delay}ms played successfully`);
          }).catch((err) => {
            console.warn(`HTML5 Audio beep ${delay}ms failed:`, err);
          });
        }, delay);
      });
      
      console.log('HTML5 Audio fallback initiated');
    } catch (fallbackError) {
      console.warn('HTML5 Audio fallback also failed:', fallbackError);
      // Visual fallback when all audio fails
      document.body.style.backgroundColor = '#dc2626';
      document.body.style.transition = 'background-color 0.2s ease';
      
      // Create a more prominent visual indicator
      const alertDiv = document.createElement('div');
      alertDiv.innerHTML = '⏰ Timer Complete!';
      alertDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #dc2626;
        color: white;
        padding: 20px 40px;
        border-radius: 10px;
        font-size: 24px;
        font-weight: bold;
        z-index: 10000;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        animation: pulse 1s infinite;
      `;
      
      // Add pulse animation
      if (!document.getElementById('timer-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'timer-pulse-style';
        style.textContent = `
          @keyframes pulse {
            0% { transform: translate(-50%, -50%) scale(1); }
            50% { transform: translate(-50%, -50%) scale(1.1); }
            100% { transform: translate(-50%, -50%) scale(1); }
          }
        `;
        document.head.appendChild(style);
      }
      
      document.body.appendChild(alertDiv);
      
      // Remove visual feedback after 3 seconds
      setTimeout(() => {
        document.body.style.backgroundColor = '';
        document.body.style.transition = '';
        if (alertDiv.parentNode) {
          alertDiv.parentNode.removeChild(alertDiv);
        }
      }, 3000);
      
      // Try to show browser notification as well
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('⏰ Timer Complete!', {
          body: 'Your countdown timer has finished.',
          icon: '/favicon.ico',
          tag: 'timer-complete' // Prevent duplicate notifications
        });
      }
    }
  }
}

// Play celebration sound for workout completion
function playWorkoutCompletionSound() {
  try {
    // Create audio context
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Create a happy ascending melody: C-E-G-C (major triad + octave)
    const frequencies = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    const delays = [0, 150, 300, 450]; // Note timings
    
    frequencies.forEach((freq, index) => {
      setTimeout(() => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        
        // Configure oscillator for a warmer sound
        o.type = 'sine';
        o.frequency.value = freq;
        o.connect(g);
        g.connect(ctx.destination);
        g.gain.value = 1.0; // Use system volume
        
        // Play with slight decay for musical effect
        o.start();
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        setTimeout(() => { 
          o.stop(); 
          // Only close context after the last note
          if (index === frequencies.length - 1) {
            setTimeout(() => ctx.close(), 100);
          }
        }, 400);
      }, delays[index]);
    });
    
    console.log('Workout completion melody played successfully');
  } catch (e) {
    console.warn('WebAudio failed for completion sound, trying fallback:', e);
    // Fallback: use the same beep as timer but shorter
    try { 
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmkiBUAAfwA=');
      // Use system volume instead of setting audio.volume
      audio.play().then(() => {
        console.log('Completion fallback audio played successfully');
      }).catch(() => {
        console.log('Audio fallback failed for completion sound');
      });
    } catch (_) {
      console.log('All audio methods failed for completion sound');
    }
    
    // Show congratulatory notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('🎉 Workout Complete!', {
        body: 'Great job finishing your workout session!',
        icon: '/favicon.ico',
        tag: 'workout-complete'
      });
    }
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
      { id: crypto.randomUUID(), name: "Pull-ups", minSets: 3, targetReps: 6, intensity: 0, sets: [0, 0, 0], notes: "" },
      { id: crypto.randomUUID(), name: "Push-ups", minSets: 3, targetReps: 12, intensity: 0, sets: [0, 0, 0], notes: "" },
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

// Weekly Benchmark Stack Component - shows previous weeks using the actual WeeklyTracker format
function WeeklyBenchmarkStack({ 
  previousWeeks, 
  onUpdateWeek 
}: { 
  previousWeeks: WeeklyPlan[];
  onUpdateWeek: (week: WeeklyPlan) => void;
}) {
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  
  const toggleWeek = (weekNumber: number) => {
    const newExpanded = new Set(expandedWeeks);
    if (newExpanded.has(weekNumber)) {
      newExpanded.delete(weekNumber);
    } else {
      newExpanded.add(weekNumber);
    }
    setExpandedWeeks(newExpanded);
  };

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

  return (
    <div className="space-y-4 mt-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-semibold text-gray-800">Previous Weeks</h3>
        <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
          {previousWeeks.length} weeks
        </span>
      </div>

      {previousWeeks.map((week, index) => {
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
    </div>
  );
}

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
  
  const toggleWorkout = (dayIndex: number, type: string) => {
    console.log(`🔄 [${new Date().toISOString()}] Toggle workout - Day ${dayIndex}, Type: ${type}`);
    
    const updatedWeekly = { ...weekly };
    updatedWeekly.days = [...weekly.days];
    updatedWeekly.days[dayIndex] = { ...weekly.days[dayIndex] };
    
    // Toggle the workout type
    const currentValue = updatedWeekly.days[dayIndex].types?.[type] || false;
    console.log(`Current value for ${type}: ${currentValue} -> ${!currentValue}`);
    
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
    
    console.log(`📊 Updated day ${dayIndex}:`, updatedWeekly.days[dayIndex]);
    console.log(`🚀 Calling onUpdateWeek...`);
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
                        
                        {/* Comment indicator */}
                        {hasComment && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full" title={day.comments?.[type]}></div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

// --- Components ---
export default function WorkoutTrackerApp() {
  const [weekly, setWeekly] = useState<WeeklyPlan>(defaultWeekly());
  console.debug('[WT] Initial weekly state:', { weekOfISO: weekly.weekOfISO, mondayFromState: new Date(weekly.weekOfISO).toDateString() });
  
  // Track whenever weekly state changes
  useEffect(() => {
    console.debug('[WT] Weekly state changed:', { 
      weekOfISO: weekly.weekOfISO, 
      mondayFromState: new Date(weekly.weekOfISO).toDateString(),
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n') 
    });
  }, [weekly.weekOfISO]);
  const [previousWeeks, setPreviousWeeks] = useState<WeeklyPlan[]>([]);
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
      Notification.requestPermission().then(permission => {
        console.log('Notification permission:', permission);
      });
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
              console.debug('Loaded username from Firestore:', loadedUsername);
              setUserName(loadedUsername);
            } else {
              // No username set yet, use display name as default and save it
              const defaultUsername = u.displayName || u.email?.split('@')[0] || 'User';
              console.debug('No saved username, using default:', defaultUsername);
              setUserName(defaultUsername);
              await setDoc(profileRef, { username: defaultUsername, email: u.email }, { merge: true });
              console.debug('Saved default username to Firestore');
            }
          } catch (e) {
            console.warn('Failed to load username, using fallback:', e);
            const fallbackUsername = u.displayName || u.email?.split('@')[0] || 'User';
            setUserName(fallbackUsername);
          }
          // Prefer per-week document keyed by weekOfISO. Fall back to the legacy 'tracker' doc.
          try {
            const currentMonday = getMonday();
            const currentWeekISO = toISO(currentMonday);
            console.debug('[WT] Loading current week:', { currentMonday: currentMonday.toDateString(), currentWeekISO });
            const weekRef = doc(db, 'users', u.uid, 'state', currentWeekISO);
            const wSnap = await getDoc(weekRef);
            if (wSnap.exists()) {
              const data = wSnap.data() as PersistedState;
              console.debug('[WT] Found existing weekly data for current week:', { weekISO: currentWeekISO, data });
              if (data?.weekly) {
                // dedupe types and normalize
                const uniq = ensureUniqueTypes(data.weekly.customTypes || []);
                let normalized = normalizeWeekly({ ...data.weekly, customTypes: uniq, weekOfISO: currentWeekISO } as WeeklyPlan);
                
                // Ensure days array matches current week dates
                const currentWeekDates = weekDates(currentMonday).map(d => toISO(d));
                const existingDates = normalized.days.map(d => d.dateISO);
                
                if (!arraysEqual(currentWeekDates, existingDates)) {
                  console.debug('[WT] Days mismatch, regenerating for current week:', { expected: currentWeekDates, found: existingDates });
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
                
                console.debug('[WT] Loaded per-week state (corrected)', safeString({ uid: u.uid, week: currentWeekISO, normalized, correctedWeekOfISO: normalized.weekOfISO }));
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
                  
                  // Load multiple previous weeks for benchmark display
                  try {
                    const prevWeeksData: WeeklyPlan[] = [];
                    const currentMonday = getMonday();
                    console.debug('[WT] Loading previous weeks, current Monday:', toISO(currentMonday));
                    
                    // Load previous 4 weeks
                    for (let i = 1; i <= 4; i++) {
                      const prevMonday = new Date(currentMonday);
                      prevMonday.setDate(currentMonday.getDate() - (7 * i)); // Go back i weeks
                      const prevMondayISO = toISO(prevMonday);
                      
                      console.debug(`[WT] Checking week ${i}, Monday: ${prevMondayISO}`);
                      
                      const prevWeekRef = doc(db, 'users', u.uid, 'state', prevMondayISO);
                      const prevSnap = await getDoc(prevWeekRef);
                      
                      if (prevSnap.exists()) {
                        const prevData = prevSnap.data() as PersistedState;
                        console.debug(`[WT] Found data for ${prevMondayISO}:`, prevData);
                        
                        if (prevData?.weekly) {
                          const prevUniq = ensureUniqueTypes(prevData.weekly.customTypes || []);
                          let prevNormalized = normalizeWeekly({ ...prevData.weekly, customTypes: prevUniq } as WeeklyPlan);
                          prevWeeksData.push(prevNormalized);
                          console.debug('[WT] Loaded previous week', { 
                            week: i, 
                            weekNumber: prevNormalized.weekNumber, 
                            date: prevMondayISO,
                            customTypes: prevNormalized.customTypes,
                            daysWithData: prevNormalized.days.filter(d => Object.keys(d.types || {}).length > 0).length
                          });
                        } else {
                          console.debug(`[WT] No weekly data in document for ${prevMondayISO}`);
                        }
                      } else {
                        console.debug(`[WT] No document found for ${prevMondayISO}`);
                      }
                    }
                    
                    // Sort by date descending (most recent first) then assign sequential week numbers
                    prevWeeksData.sort((a, b) => new Date(b.weekOfISO).getTime() - new Date(a.weekOfISO).getTime());
                    
                    // Assign sequential week numbers based on chronological order
                    // Most recent week gets the highest number
                    const totalWeeks = prevWeeksData.length + 1; // +1 for current week
                    prevWeeksData.forEach((weekData, index) => {
                      weekData.weekNumber = totalWeeks - index - 1; // -1 because current week gets the highest number
                    });
                    
                    // Update current week number too
                    setWeekly(prev => ({ ...prev, weekNumber: totalWeeks }));
                    
                    setPreviousWeeks(prevWeeksData);
                    console.debug('[WT] Final previous weeks loaded with sequential numbering', { 
                      count: prevWeeksData.length, 
                      currentWeekNumber: totalWeeks,
                      weeks: prevWeeksData.map(w => ({ 
                        weekNumber: w.weekNumber, 
                        weekOfISO: w.weekOfISO,
                        typesCount: w.customTypes.length,
                        activeDays: w.days.filter(d => Object.keys(d.types || {}).length > 0).length
                      })) 
                    });
                  } catch (e) {
                    console.warn('[WT] Failed to load previous weeks data', e);
                    setPreviousWeeks([]);
                  }
              }
              if (data?.session) setSession(data.session);
            } else {
              console.debug('[WT] No current week data found, checking legacy tracker doc');
              // fallback to legacy tracker doc
              const ref = doc(db, "users", u.uid, "state", "tracker");
              const snap = await getDoc(ref);
              if (snap.exists()) {
                const data = snap.data() as PersistedState;
                console.debug('[WT] Found legacy tracker data:', { data });
                if (data?.weekly) {
                  // Apply same week correction logic as current week loading
                  const normalized = normalizeWeekly({ 
                    ...data.weekly, 
                    customTypes: ensureUniqueTypes(data.weekly.customTypes || []),
                    weekOfISO: currentWeekISO // Force current week ISO
                  } as WeeklyPlan);
                  
                  // Ensure days array matches current week dates
                  const currentWeekDates = weekDates(currentMonday).map(d => toISO(d));
                  const existingDates = normalized.days.map(d => d.dateISO);
                  
                  if (!arraysEqual(currentWeekDates, existingDates)) {
                    console.debug('[WT] Legacy data days mismatch, regenerating for current week:', { expected: currentWeekDates, found: existingDates });
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
                  
                  console.debug('[WT] Loaded legacy tracker state (corrected)', { uid: u.uid, normalized, correctedWeekOfISO: normalized.weekOfISO });
                  setWeekly(normalized);
                }
                if (data?.session) setSession(data.session);
              } else {
                console.debug('[WT] No legacy tracker data found, using defaultWeekly()');
                const defaultWk = defaultWeekly();
                console.debug('[WT] Generated defaultWeekly:', { weekOfISO: defaultWk.weekOfISO, monday: getMonday().toDateString() });
                setWeekly(defaultWk);
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

  // celebration and debug override removed

  // confetti and celebration removed

  // ...existing code...

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
        
        {/* Weekly Benchmark Stack - Previous weeks as collapsible benchmark charts */}
        <WeeklyBenchmarkStack 
          previousWeeks={previousWeeks} 
          onUpdateWeek={async (week) => {
            try {
              console.log('📝 onUpdateWeek called with:', week);
              console.log('💾 Saving edited week:', week.weekOfISO);
              
              if (!userId) {
                console.error('❌ No user ID available');
                return;
              }
              
              // Save the updated week to Firebase - Clean undefined values
              const cleanWeek = JSON.parse(JSON.stringify(week, (_key, value) => {
                return value === undefined ? null : value;
              }));
              
              const weekRef = doc(db, 'users', userId, 'state', week.weekOfISO);
              await setDoc(weekRef, { weekly: cleanWeek });
              
              console.log('✅ Week saved successfully to Firebase');
              
              // Update local state to reflect changes
              setPreviousWeeks(prev => {
                const updated = prev.map(w => w.weekOfISO === week.weekOfISO ? week : w);
                console.log('🔄 Updated previousWeeks state');
                return updated;
              });
              
            } catch (error) {
              console.error('❌ Error saving week:', error);
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
  
  // Comment modal state
  const [commentModal, setCommentModal] = useState<{ 
    type: string; 
    dateISO: string; 
    dayIndex: number; 
    comment: string; 
  } | null>(null);

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

  const monday = new Date(weekly.weekOfISO + 'T00:00:00'); // Add time to avoid timezone issues
  console.log('WeeklyTracker: weekOfISO:', weekly.weekOfISO, 'monday:', monday.toDateString());
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

  // --- Comment handling ---
  const openCommentModal = (type: string, dateISO: string, dayIndex: number) => {
    const existingComment = weekly.days[dayIndex]?.comments?.[type] || '';
    setCommentModal({
      type,
      dateISO,
      dayIndex,
      comment: existingComment
    });
  };

  const saveComment = async () => {
    if (!commentModal) return;
    
    const { type, dayIndex, comment } = commentModal;
    const days = [...weekly.days];
    const day = { ...days[dayIndex] };
    
    // Initialize comments object if it doesn't exist
    if (!day.comments) {
      day.comments = {};
    } else {
      day.comments = { ...day.comments };
    }
    
    // Update or remove comment
    if (comment.trim()) {
      day.comments[type] = comment.trim();
    } else {
      delete day.comments[type];
    }
    
    days[dayIndex] = day;
    setWeekly({ ...weekly, days });
    
    // Persist to Firestore if user is signed in
    const uid = auth.currentUser?.uid;
    if (uid) {
      try {
        await setDoc(doc(db, 'users', uid, 'state', weekly.weekOfISO), {
          weekly: { days: days }
        }, { merge: true });
      } catch (e) {
        console.warn('Failed to save comment to Firestore', e);
        push?.('Failed to save comment', 'error');
      }
    }
    
    setCommentModal(null);
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
          <Button variant="outline" onClick={() => {
            // Reset to current week
            const currentMon = getMonday();
            const currentWeekISO = toISO(currentMon);
            const currentWeekDates = weekDates(currentMon).map(d => toISO(d));
            
            console.debug('[WT] Reset button clicked - Monday calculation:', {
              today: new Date().toDateString(),
              monday: currentMon.toDateString(),
              mondayISO: currentWeekISO,
              weekDates: currentWeekDates
            });
            
            const newWeekly: WeeklyPlan = {
              ...weekly,
              weekOfISO: currentWeekISO,
              days: currentWeekDates.map(dateISO => {
                const existingDay = weekly.days.find(d => d.dateISO === dateISO);
                return existingDay || {
                  dateISO,
                  types: {},
                  sessions: 0,
                  sessionsList: [],
                  comments: {}
                };
              })
            };
            
            console.debug('[WT] Resetting to current week:', { old: weekly.weekOfISO, new: currentWeekISO });
            setWeekly(newWeekly);
            push?.('Reset to current week', 'success');
          }}>
            Reset to Current Week
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
                            title="Edit type name/category"
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
                            title="Delete type completely"
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
                            "p-2 text-center align-middle border-b cursor-pointer relative hover-parent",
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
                          <div className="flex items-center justify-center gap-1">
                            {/* Main checkbox area */}
                            <div className="flex-1 flex justify-center">
                              {active ? <Check className="inline h-4 w-4" /> : ""}
                            </div>
                            
                            {/* Comment indicator/button */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className={cn(
                                "h-5 w-5 p-0 absolute top-0 right-0 m-0.5 transition-opacity",
                                "opacity-0 hover:!opacity-100",
                                "[.hover-parent:hover_&]:opacity-60",
                                d.comments?.[t] && "!opacity-60 text-blue-600 bg-blue-50"
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                openCommentModal(t, d.dateISO, idx);
                              }}
                              title={d.comments?.[t] ? `Comment: ${d.comments[t]}` : "Add comment"}
                            >
                              <MessageSquare className="h-3 w-3" />
                            </Button>
                          </div>
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
      
      {/* Comment Modal */}
      {commentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              Add Comment - {commentModal.type}
            </h3>
            <p className="text-sm text-gray-600 mb-3">
              {new Date(commentModal.dateISO + 'T00:00').toLocaleDateString(undefined, { 
                weekday: 'long', 
                month: 'short', 
                day: 'numeric' 
              })}
            </p>
            <div className="space-y-4">
              <textarea
                className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={4}
                placeholder="Add notes about this activity..."
                value={commentModal.comment}
                onChange={(e) => setCommentModal({
                  ...commentModal,
                  comment: e.target.value
                })}
              />
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setCommentModal(null)}>
                Cancel
              </Button>
              <Button onClick={saveComment}>
                Save Comment
              </Button>
            </div>
          </div>
        </div>
      )}
  </Card>
  );
}

// --- Workout Session ---
function WorkoutView({
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
    console.debug('[WT] completeWorkout called', safeString({ sessionDate: today, todayIndex, sessionTypes: session.sessionTypes, weeklyDays: weekly.days.map((d) => d.dateISO) }));

    // Persist completed session to Firestore first so we get a document id
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        console.warn('[WT] completeWorkout: no user id, cannot persist session');
      } else {
        const payload = { ...session, completed: true, durationSec: timerSec, completedAt: Date.now() };
        console.log('HistoryView: Saving completed session:', payload);
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
    console.log('[SaveRoutine] Checking if routine can be saved...');
    
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
    console.log('[SaveRoutine] Starting save routine process...');
    console.log('[SaveRoutine] Session data:', {
      routineName: routineName,
      exercisesCount: session.exercises.length,
      exercises: session.exercises.map(e => ({ name: e.name, minSets: e.minSets, targetReps: e.targetReps })),
      sessionTypes: session.sessionTypes
    });
    
    try {
      const uid = auth.currentUser?.uid;
      console.log('[SaveRoutine] User ID:', uid);
      
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
      
      console.log('[SaveRoutine] Payload to save:', payload);
      
      if (!uid) {
        console.log('[SaveRoutine] User not signed in, saving locally');
        saveLocalRoutine(payload);
        toasts.push(`Routine "${routineName}" saved locally!`, 'success');
      } else {
        console.log('[SaveRoutine] Saving to Firestore...');
        const ref = collection(db, 'users', uid, 'routines');
        const docRef = await addDoc(ref, payload as any);
        console.log('[SaveRoutine] Saved successfully with ID:', docRef.id);
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
            console.log('[CLICK] Save Routine button clicked!');
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
        console.log('Skipping history load for invalid exercise name:', exerciseName);
        setExerciseHistory({});
        return;
      }
      
      console.log('Loading history for exercise:', exerciseName);
      console.log('🔍 Debug: Exercise name validation passed for:', exerciseName);
      setHistoryLoading(true);
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) {
          console.log('❌ No user authenticated');
          return;
        }
        
        console.log('✅ User authenticated, uid:', uid);
        
        // Query sessions that contain this exercise
        const sessionsRef = collection(db, 'users', uid, 'sessions');
        const snaps = await getDocs(sessionsRef);
        console.log('Found', snaps.docs.length, 'total sessions');
        
        // Debug: Log all sessions
        console.log('Found', snaps.docs.length, 'total sessions for exercise:', ex.name);
        const sessionsWithExercises = snaps.docs.filter(doc => {
          const data = doc.data();
          return data.exercises && data.exercises.length > 0;
        });
        console.log('Sessions with exercises:', sessionsWithExercises.length);
        
        if (sessionsWithExercises.length > 0) {
          console.log('📋 All available exercise names in database:');
          const allExerciseNames = new Set();
          sessionsWithExercises.forEach(doc => {
            const data = doc.data();
            data.exercises?.forEach((e: any) => {
              const cleanName = (e.name || '').replace(/['"]/g, '').trim();
              allExerciseNames.add(cleanName);
            });
          });
          console.log([...allExerciseNames].sort());
          console.log('🎯 Searching for:', exerciseName);
          
          // Special debugging for specific exercises
          if (exerciseName.toLowerCase().includes('bodyweight') || exerciseName.toLowerCase().includes('ring')) {
            console.log('🚨 SPECIAL DEBUG for', exerciseName);
            console.log('Available names that might match:');
            Array.from(allExerciseNames).forEach((name) => {
              const nameStr = String(name);
              if (nameStr.toLowerCase().includes('bodyweight') || nameStr.toLowerCase().includes('ring') || nameStr.toLowerCase().includes('row') || nameStr.toLowerCase().includes('rollout')) {
                console.log('  - "' + nameStr + '"');
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
                console.log(`🔍 Comparing stored: "${cleanStoredName}" with search: "${cleanSearchName}"`);
              }
              
              // Exact match
              if (cleanStoredName === cleanSearchName) {
                console.log(`✅ Exact match found: "${cleanStoredName}" === "${cleanSearchName}"`);
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
                console.log(`✅ Fuzzy match found: "${cleanStoredName}" ~= "${cleanSearchName}"`);
              }
              
              return fuzzyMatch;
            });
            console.log('Session', session.id, 'completed:', hasCompletedAt, 'has matching exercise for "' + ex.name + '":', hasMatchingExercise);
            if (session.exercises) {
              console.log('  Exercise names in session:', session.exercises.map((e: any) => '"' + e.name + '"'));
            }
            return hasCompletedAt && hasMatchingExercise;
          })
          .sort((a: any, b: any) => (b.completedAt || 0) - (a.completedAt || 0));

        console.log('Found', matchingSessions.length, 'matching completed sessions');

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

          console.log('Exercise instances found:', exerciseInstances);

          // Find last workout (most recent completed)
          const lastWorkout = exerciseInstances[0];
          
          // Find personal record (highest total reps)
          const personalRecord = exerciseInstances.reduce((best, current) => {
            const currentTotal = (current.sets || []).reduce((sum: number, reps: number) => sum + reps, 0);
            const bestTotal = (best?.sets || []).reduce((sum: number, reps: number) => sum + reps, 0);
            return currentTotal > bestTotal ? current : best;
          }, null);

          // Get recent workouts (last 5 completed sessions, excluding duplicates)
          const uniqueSessions = new Map();
          exerciseInstances.forEach(instance => {
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
          
          console.log('Setting exercise history:', historyData);
          setExerciseHistory(historyData);
        } else {
          // Clear history if no completed sessions found
          console.log('No completed sessions found, clearing history');
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

  // Debug: Log exercise data
  console.log('🏋️ ExerciseCard render:', {
    id: ex.id,
    name: `"${ex.name}"`,
    nameLength: ex.name?.length || 0,
    minSets: ex.minSets,
    targetReps: ex.targetReps,
    intensity: ex.intensity,
    sets: ex.sets
  });

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
          {goalMet && (
            <span className="text-green-700 flex items-center gap-1"><Check className="h-4 w-4"/> goal met</span>
          )}
          <Button variant="destructive" onClick={onDelete}>
            <Trash2 className="mr-2 h-4 w-4" /> Remove
          </Button>
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

function HistoryView({ weekly, setWeekly, setSession, previousWeeks }: { weekly: WeeklyPlan; setWeekly: (w: WeeklyPlan) => void; setSession: (s: ResistanceSession) => void; previousWeeks: WeeklyPlan[] }) {
  const toasts = useToasts();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [showAllHistoryDays, setShowAllHistoryDays] = useState<Record<string, boolean>>({});

  // Log component mount
  console.log('HistoryView: Component mounted, auth state:', !!auth.currentUser, 'weekly days:', weekly.days.length);

  useEffect(() => {
    let mounted = true;
    
    async function loadSessions() {
      try {
        setLoading(true);
        const uid = auth.currentUser?.uid;
        console.log('HistoryView: Loading sessions for user:', uid);
        
        if (!uid) {
          console.log('HistoryView: No authenticated user');
          if (mounted) {
            setItems([]);
            setLoading(false);
          }
          return;
        }

        // Query for sessions that are completed (either have completed: true OR have completedAt field)
        // Temporarily get ALL sessions to understand the data discrepancy
        const q = query(
          collection(db, 'users', uid, 'sessions'),
          where('completedAt', '!=', null),
          orderBy('completedAt', 'desc')
        );
        
        console.log('HistoryView: Executing Firestore query...');
        const snapshot = await getDocs(q);
        const sessions = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        console.log('HistoryView: Found sessions:', sessions.length);

        // Debug: Check for duplicates and data quality
        const sessionsByDate: any = {};
        sessions.forEach((session: any) => {
          const date = session.dateISO || session.date;
          if (!sessionsByDate[date]) sessionsByDate[date] = [];
          sessionsByDate[date].push({
            id: session.id,
            sessionTypes: session.sessionTypes,
            completedAt: session.completedAt,
            exercises: session.exercises?.length || 0,
            timestamp: session.completedAt?.toDate?.() || session.completedAt
          });
        });
        console.log('HistoryView: Sessions grouped by date:', Object.keys(sessionsByDate));

        // Debug: Compare Firestore data with weekly tracker data
        // Weekly data debug info
        console.log('HistoryView: Weekly.days length:', weekly.days?.length);
        
        // Log session dates vs weekly days with sessions for comparison
        if (sessions.length > 0) {
          const sessionDates = sessions.map((s: any) => {
            const date = s.dateISO || (s.completedAt?.toDate ? s.completedAt.toDate().toISOString().split('T')[0] : 'unknown');
            return date;
          }).filter(Boolean);
        console.log('HistoryView: Firestore session dates:', sessionDates.length, 'sessions');
        }
        
        const weeklyDatesWithSessions = weekly.days
          .filter(day => day.sessionsList && day.sessionsList.length > 0)
          .map(day => day.dateISO);
        console.log('HistoryView: Weekly tracker dates with sessions:', weeklyDatesWithSessions);

        // Use all sessions for now
        console.log('HistoryView: Total Firestore sessions found:', sessions.length);

        // PRIORITY FIX: Show actual recent sessions from weekly tracker data, not old test data
        let displaySessions: any[] = [];
        
        // Process ALL weekly data (current week + previous weeks)
        const allWeeklyData = [weekly, ...previousWeeks];
        
        allWeeklyData.forEach((weekData) => {
          weekData.days?.forEach((day: any) => {
            // Get all active workout types for this day
            const activeTypes = day.types ? Object.keys(day.types).filter(t => day.types[t]) : [];
            
            if (activeTypes.length > 0) {
              // Create a single session representing all workout types for the day
              const sessionData = {
                id: `daily:${day.dateISO}:${Date.now()}:${Math.random()}`, // Add more uniqueness
                dateISO: day.dateISO,
                sessionName: activeTypes.join(' + '),
                sessionTypes: activeTypes,
                completed: true,
                exercises: [],
                durationSec: 0,
                completedAt: new Date(day.dateISO + 'T12:00:00'),
                source: 'weekly_tracker_types'
              };
              displaySessions.push(sessionData);
            }
          });
        });

        // Add Firestore sessions, but only if they don't conflict with weekly tracker data
        const weeklyTrackerDates = displaySessions.map(s => s.dateISO);
        
        sessions.forEach((fs: any) => {
          const fsDate = fs.dateISO || (fs.completedAt?.toDate ? fs.completedAt.toDate().toISOString().split('T')[0] : null);
          
          // Only add Firestore sessions from dates NOT covered by weekly tracker data
          if (fsDate && !weeklyTrackerDates.includes(fsDate)) {
            displaySessions.push({ ...fs, source: 'firestore' });
          }
        });
        
        // Debug: Show what sessions are for each day in the current week

        // Debug: Check for potential duplicates
        const duplicateCheckByDate: any = {};
        displaySessions.forEach(session => {
          const date = session.dateISO;
          if (!duplicateCheckByDate[date]) duplicateCheckByDate[date] = [];
          duplicateCheckByDate[date].push({
            id: session.id,
            source: session.source,
            sessionName: session.sessionName
          });
        });
        // Debug: Sessions grouped by date for duplicate check

        if (mounted) {
          // Force a complete re-render by clearing first, then setting
          setItems([]);
          setTimeout(() => {
            if (mounted) {
              setItems(displaySessions);
              setLoading(false);
            }
          }, 10);
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
  }, []);

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
      const date = new Date(session.dateISO || session.completedAt || session.ts);
      const monday = getMonday(date);
      const weekKey = toISO(monday);
      const dayKey = toISO(date);
      
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

  if (loading) return (
    <div className="p-4 text-center">
      <div>Loading history...</div>
      <div className="text-xs text-gray-500 mt-2">
        Querying Firestore for user: {auth.currentUser?.email}
      </div>
    </div>
  );
  
  if (items.length === 0) return (
    <div className="text-sm text-neutral-600 space-y-2">
      <div>No history yet. Complete sessions will appear here.</div>
      <div className="text-xs text-gray-400 bg-gray-50 p-2 rounded">
        <div><strong>Debug info:</strong></div>
        <div>User authenticated: {auth.currentUser ? 'Yes' : 'No'}</div>
        <div>User ID: {auth.currentUser?.uid || 'None'}</div>
        <div>User email: {auth.currentUser?.email || 'None'}</div>
        <div>Items loaded: {items.length}</div>
        <div>Weekly days with sessions: {weekly.days.filter(d => d.sessionsList && d.sessionsList.length > 0).length}</div>
        <div>Firebase project: fcoworkout</div>
        <div>Environment: {window.location.hostname}</div>
      </div>
      <div className="flex gap-2">
        <button 
          onClick={() => {
            window.location.reload();
          }}
          className="px-3 py-1 bg-green-500 text-white rounded text-xs"
        >
          Reload History
        </button>
        <button 
          onClick={() => {
            console.log('Current auth state:', auth.currentUser);
            console.log('Weekly data:', weekly);
          }}
          className="px-3 py-1 bg-gray-500 text-white rounded text-xs"
        >
          Log Debug Info
        </button>
        <button 
          onClick={async () => {
            try {
              const uid = auth.currentUser?.uid;
              if (!uid) {
                alert('Not authenticated');
                return;
              }
              console.log('Manual query for user:', uid);
              const q = query(
                collection(db, 'users', uid, 'sessions'),
                where('completedAt', '!=', null)
              );
              const snapshot = await getDocs(q);
              const sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
              console.log('Manual query result:', sessions);
              alert(`Found ${sessions.length} sessions. Check console for details.`);
            } catch (e) {
              console.error('Manual query error:', e);
              alert('Error: ' + e);
            }
          }}
          className="px-3 py-1 bg-blue-500 text-white rounded text-xs"
        >
          Test Query
        </button>
      </div>
    </div>
  );

  const sortedWeeks = Object.keys(groupedSessions).sort().reverse();

  // Always show debug info at the top
  const historyDebugInfo = {
    authenticated: !!auth.currentUser,
    uid: auth.currentUser?.uid,
    email: auth.currentUser?.email,
    itemsCount: items.length,
    loading: loading,
    weeklyDaysWithSessions: weekly.days.filter(d => d.sessionsList && d.sessionsList.length > 0).length,
    sortedWeeksCount: sortedWeeks.length
  };

  return (
    <div className="space-y-4">
      {/* Debug panel - always visible */}
      <div className="bg-yellow-50 border border-yellow-200 p-3 rounded text-sm">
        <div className="font-bold mb-2">Debug Info:</div>
        <div>Status: {loading ? 'Loading...' : 'Loaded'}</div>
        <div>User: {historyDebugInfo.email || 'Not signed in'}</div>
        <div>Sessions loaded: {historyDebugInfo.itemsCount}</div>
        <div>Grouped weeks: {historyDebugInfo.sortedWeeksCount}</div>
        <div>Weekly days with sessions: {historyDebugInfo.weeklyDaysWithSessions}</div>
        <button 
          onClick={async () => {
            try {
              const uid = auth.currentUser?.uid;
              if (!uid) {
                alert('Not authenticated');
                return;
              }
              console.log('Manual query for user:', uid);
              const q = query(
                collection(db, 'users', uid, 'sessions'),
                where('completedAt', '!=', null),
                orderBy('completedAt', 'desc')
              );
              const snapshot = await getDocs(q);
              const sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
              console.log('Manual query result:', sessions);
              alert(`Found ${sessions.length} sessions. Check console for details.`);
            } catch (e) {
              console.error('Manual query error:', e);
              alert('Error: ' + e);
            }
          }}
          className="mt-2 px-3 py-1 bg-blue-500 text-white rounded text-xs"
        >
          Test Firestore Query
        </button>
      </div>

      {loading && (
        <div className="p-4 text-center">
          <div>Loading history...</div>
          <div className="text-xs text-gray-500 mt-2">
            Querying Firestore for user: {auth.currentUser?.email}
          </div>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-sm text-neutral-600 space-y-2">
          <div>No history yet. Complete sessions will appear here.</div>
        </div>
      )}

      {!loading && sortedWeeks.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Session History ({items.length} sessions)</h3>
          {sortedWeeks.map((weekKey) => {
        const weekData = groupedSessions[weekKey];
        const weekStart = new Date(weekKey);
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
                    const date = new Date(dateISO);
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
                              {Array.from(new Set(daySessions.flatMap(s => s.sessionTypes || []))).map(type => (
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
                            {(showAllHistoryDays[dayKey] ? daySessions : daySessions.slice(0, 3)).map((session) => (
                              <Card key={session.id} className={cn('border', getTypeColor(session.sessionTypes || []))}>
                                <CardHeader className="pb-2">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="font-semibold">{session.sessionName}</div>
                                      <div className="text-xs text-neutral-600">
                                        {new Date(session.completedAt || session.ts || Date.now()).toLocaleTimeString()}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {session.exercises && session.exercises.length > 0 && (
                                        <div className="text-sm text-neutral-600">{session.exercises.length} exercises</div>
                                      )}
                                      <Button variant="outline" size="sm" onClick={(e) => {
                                        e.stopPropagation();
                                        // Load this session back into the current workout for editing
                                        const editableSession: ResistanceSession = {
                                          ...session,
                                          completed: false, // Mark as not completed so it can be edited
                                          dateISO: toISO(new Date()), // Update to today's date
                                          durationSec: 0 // Reset timer
                                        };
                                        setSession(editableSession);
                                        toasts.push('Session loaded for editing', 'success');
                                      }}>
                                        <Edit className="h-3 w-3 mr-1" />
                                        Edit
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

function LibraryView({ userName, onLoadRoutine }: { userName: string | null; onLoadRoutine: (s: ResistanceSession, mode?: 'replace'|'append') => void }) {
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

  const addComposerExercise = () => setComposerExercises(prev => [...prev, { id: crypto.randomUUID(), name: '', minSets: 3, targetReps: 8, intensity: 0, sets: [0,0,0], notes: '' }]);

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
      if (composerKind === 'routine' && !composerName) { setSaveMessage('Name the routine'); return; }
      if (composerKind === 'exercise' && composerExercises.length === 0) { setSaveMessage('Add at least one exercise'); return; }
      if (!uid) { setSaveMessage('Sign in to save routines and exercises to the global library'); return; }
      // Signed-in: persist to Firestore
      
        // Signed-in: persist to Firestore
        if (composerKind === 'exercise') {
          const ref = collection(db, 'users', uid, 'exercises');
          const createdIds: string[] = [];
          for (const ex of composerExercises) {
            const payload = { name: ex.name, minSets: ex.minSets, targetReps: ex.targetReps, createdAt: Date.now(), public: composerPublic, owner: uid, ownerName: userName || 'User' };
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
          const payload = { name: composerName, exercises: composerExercises.map(e => ({ name: e.name, minSets: e.minSets, targetReps: e.targetReps })), sessionTypes: [], createdAt: Date.now(), public: composerPublic, owner: uid, ownerName: userName || 'User' };
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

  const loadList = async (useFilter?: string) => {
    setLoading(true);
    setItems([]); // Clear previous data to prevent mixing between filters
    try {
      const uid = auth.currentUser?.uid;
      const currentFilter = useFilter || filter;
      console.log('[Library] Loading list, uid:', uid, 'filter:', currentFilter);
      if (!uid) {
        // Not signed in: load public content based on filter type
        console.log('[Library] Not signed in, loading public content for filter:', currentFilter);
        let data: any[] = [];
        
        if (currentFilter === 'exercise') {
          // Only load public individual exercises
          try {
            const cgEx = query(collectionGroup(db, 'exercises'), where('public', '==', true));
            const publicExSnaps = await getDocs(cgEx);
            data = publicExSnaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: d.ref.parent.parent?.id || 'unknown', kind: 'exercise' }));
            
            // Also extract exercises from public routines
            const cgRt = query(collectionGroup(db, 'routines'), where('public', '==', true));
            const publicRtSnaps = await getDocs(cgRt);
            publicRtSnaps.docs.forEach(d => {
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
                  ownerName: routine.ownerName || 'User',
                  createdAt: routine.createdAt
                });
              });
            });
          } catch (e) {
            console.error('Failed to load public exercises:', e);
          }
        } else if (currentFilter === 'workout') {
          // Only load public routines
          try {
            const cgRt = query(collectionGroup(db, 'routines'), where('public', '==', true));
            const publicRtSnaps = await getDocs(cgRt);
            data = publicRtSnaps.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: d.ref.parent.parent?.id || 'unknown', kind: 'routine' }));
          } catch (e) {
            console.error('Failed to load public routines:', e);
          }
        } else if (currentFilter === 'user') {
          // Unsigned users have no personal content
          data = [];
        } else if (currentFilter === 'favorites') {
          // Unsigned users have no favorites  
          data = [];
        } else {
          // 'all' filter - load both
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
        }
        
        // Apply favorites filter (will be empty for unsigned users)
        data = data.map(it => ({ ...it, favorite: false }));
        
        console.log('[Library] Final setItems call with', data.length, 'items');
        console.log('[DEBUG] Filter:', filter, 'Data sample:', data.slice(0, 3).map(d => ({ name: d.name, kind: d.kind, exercises: d.exercises?.length })));
        const sortedData = data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setItems(sortedData);
        setLoading(false);
        return;
      }
      
      let data: any[] = [];
      
      if (currentFilter === 'exercise') {
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
        console.log('[DEBUG] Loading user content for uid:', uid);
        const refEx = collection(db, 'users', uid, 'exercises');
        const snapsEx = await getDocs(refEx);
        const exercises = snapsEx.docs.map(d => ({ id: d.id, ...(d.data() as any), owner: uid, kind: 'exercise' }));
        console.log('[DEBUG] User exercises found:', exercises.length, exercises.map(e => e.name));
        
        const refRt = collection(db, 'users', uid, 'routines');
        const snapsRt = await getDocs(refRt);
        const routines = snapsRt.docs.map((d) => ({ id: d.id, ...(d.data() as any), owner: uid, kind: 'routine' }));
        console.log('[DEBUG] User routines found:', routines.length, routines.map(r => r.name));
        
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
      if (currentFilter === 'favorites') {
        const currentFavs = (window as any).__app_favorites_cache?.map || new Set();
        console.log('[DEBUG] Favorites filter - current cache:', Array.from(currentFavs));
        console.log('[DEBUG] Favorites filter - data before filter:', data.map(d => ({name: d.name, id: d.id, kind: d.kind})));
        data = data.filter(it => {
          const key = `${it.kind||'routine'}::${it.id}`;
          const isFav = currentFavs.has(key);
          if (isFav) console.log('[DEBUG] Found favorite:', key, it.name);
          return isFav;
        });
        console.log('[DEBUG] Favorites filter - data after filter:', data.map(d => ({name: d.name, id: d.id, kind: d.kind})));
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
            console.log('[DEBUG] Favorites listener triggered, found', snap.docs.length, 'favorites documents');
            const favSet = new Set<string>();
            snap.docs.forEach((d: any) => {
              const data = d.data();
              const favKey = `${data.itemType||'routine'}::${data.itemId}`;
              console.log('[DEBUG] Found favorite document:', d.id, 'data:', data, 'key:', favKey);
              favSet.add(favKey);
            });
            console.log('[DEBUG] Final favorites set:', Array.from(favSet));
            
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
              <div key={ex.id} className="p-3 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors space-y-3">
                <div className="flex gap-3 items-center">
                  <div className="flex-1">
                    <Input 
                      value={ex.name} 
                      placeholder="New exercise" 
                      onChange={(e) => setComposerExercises(prev => { const c = [...prev]; c[idx] = { ...c[idx], name: e.target.value }; return c; })}
                      className="font-medium border-0 bg-transparent p-0 focus:ring-0"
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
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <span>Sets:</span>
                    <Input 
                      type="number" 
                      value={String(ex.minSets)} 
                      onChange={(e) => setComposerExercises(prev => { const c = [...prev]; c[idx] = { ...c[idx], minSets: Math.max(1, parseInt(e.target.value||'1')) }; return c; })} 
                      className="w-16 text-center border-gray-200"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span>Reps:</span>
                    <Input 
                      type="number" 
                      value={String(ex.targetReps)} 
                      onChange={(e) => setComposerExercises(prev => { const c = [...prev]; c[idx] = { ...c[idx], targetReps: Math.max(1, parseInt(e.target.value||'1')) }; return c; })} 
                      className="w-16 text-center border-gray-200"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-gray-400" />
                  <Input 
                    placeholder="Notes (optional)" 
                    value={ex.notes || ''} 
                    onChange={(e) => setComposerExercises(prev => { const c = [...prev]; c[idx] = { ...c[idx], notes: e.target.value }; return c; })}
                    className="text-sm border-gray-200"
                  />
                </div>
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
              onClick={() => {
                setItems([]); // Clear items immediately for instant UI feedback
                setFilter(key as any); 
                loadList(key); // Pass the new filter value directly
              }}
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
                    it.kind === 'exercise' 
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-blue-100 text-blue-700"
                  )}>
                    {it.kind === 'exercise' 
                      ? <Target className="h-4 w-4" />
                      : <Dumbbell className="h-4 w-4" />
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
                {(it.ownerName || it.owner === auth.currentUser?.uid) && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                    <User className="h-3 w-3" />
                    {it.owner === auth.currentUser?.uid 
                      ? userName || 'User'
                      : it.ownerName?.includes('@') 
                        ? 'User' 
                        : (it.ownerName || 'User')
                    }
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
                          const exercises = (it.exercises || []).map((e: any) => ({ id: crypto.randomUUID(), name: e.name, minSets: e.minSets, targetReps: e.targetReps, sets: Array(e.minSets).fill(0), notes: e.notes || "" }));
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
                          const exercises = (it.exercises || []).map((e: any) => ({ id: crypto.randomUUID(), name: e.name, minSets: e.minSets, targetReps: e.targetReps, sets: Array(e.minSets).fill(0), notes: e.notes || "" }));
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
                          const exercise = { id: crypto.randomUUID(), name: it.name, minSets: it.minSets || 3, targetReps: it.targetReps || 8, intensity: 0, sets: Array(it.minSets || 3).fill(0), notes: it.notes || "" };
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
