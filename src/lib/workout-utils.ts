import { useState } from "react";
import { WeeklyPlan } from "@/types";

// Re-export cn from the existing utils for convenience
export { cn } from "@/lib/utils";

// --- Date Utilities ---
export function weekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

export function getMonday(date?: Date): Date {
  const d = date ? new Date(date) : new Date();
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Calculate days to Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function toISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function arraysEqual<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((val, index) => val === b[index]);
}

// --- Seed Defaults ---
export function defaultWeekly(): WeeklyPlan {
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

// Helper function to create an empty week structure for a specific Monday date
export function createEmptyWeek(mondayDate: Date, customTypes: string[] = [], typeCategories: Record<string, string> = {}): WeeklyPlan {
  const mondayISO = toISO(mondayDate);
  const days = weekDates(mondayDate).map((d) => ({
    dateISO: toISO(d),
    types: {},
    sessions: 0,
    sessionsList: [],
    comments: {},
  }));

  // Use provided customTypes or fall back to defaults
  const types = customTypes.length > 0 ? customTypes : ["Bike", "Row Machine", "Piano Practice", "Mindfulness"];
  const categories = Object.keys(typeCategories).length > 0 ? typeCategories : { Bike: 'Cardio', "Row Machine": 'Cardio', "Piano Practice": 'Skills', Mindfulness: 'Mindfulness' };

  // Create empty benchmarks for each type
  const benchmarks: Record<string, number> = {};
  types.forEach(t => {
    benchmarks[t] = 0;
  });

  return {
    weekOfISO: mondayISO,
    weekNumber: 1, // Will be recalculated later
    days,
    benchmarks,
    customTypes: types,
    typeCategories: categories,
  };
}

// --- Toast helper (non-blocking feedback) ---
export function useToasts() {
  const [messages, setMessages] = useState<{ id: string; text: string; kind?: 'info' | 'success' | 'error' }[]>([]);
  const push = (text: string, kind?: 'info' | 'success' | 'error') => {
    const id = crypto.randomUUID();
    setMessages((s) => [...s, { id, text, kind }]);
  };
  const dismiss = (id: string) => setMessages((s) => s.filter((m) => m.id !== id));
  return { messages, push, dismiss };
}

// --- localStorage helpers for global types ---
export function loadGlobalTypes(): string[] {
  try {
    // Disabled localStorage fallback — Firestore is authoritative
    return [];
  } catch {
    return [];
  }
}

export function loadTypeCategories(): Record<string, string> {
  try {
    // Disabled localStorage fallback for categories
    return {};
  } catch {
    return {};
  }
}

export function ensureUniqueTypes(arr: string[]) {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

export function normalizeWeekly(w: WeeklyPlan): WeeklyPlan {
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

// --- Session defaults ---
import { ResistanceSession } from "@/types";

export function defaultSession(): ResistanceSession {
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
export const completedGuards = new WeakSet<object>();

// localStorage routines helpers
const LS_ROUTINES = 'workout:routines';

export function loadLocalRoutines() {
  try {
    const raw = localStorage.getItem(LS_ROUTINES);
    if (!raw) return [] as any[];
    return JSON.parse(raw) as any[];
  } catch { return [] as any[]; }
}

export function saveLocalRoutine(item: any) {
  try {
    const cur = loadLocalRoutines();
    cur.unshift(item);
    localStorage.setItem(LS_ROUTINES, JSON.stringify(cur.slice(0, 100)));
  } catch (e) { console.warn('Failed to save local routine', e); }
}
