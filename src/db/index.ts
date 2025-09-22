import { openDB, IDBPDatabase } from "idb";
import type { ActivityLog, Exercise, ExerciseSet, Routine, WeeklyGoals } from "../types";

type DBSchema = {
  exercises: Exercise;
  sets: ExerciseSet;
  activities: ActivityLog;
  routines: Routine;
  weeklyGoals: { key: string; value: WeeklyGoals };
};

let _db: IDBPDatabase<DBSchema> | null = null;

export async function getDB() {
  if (_db) return _db;
  _db = await openDB<DBSchema>("myworkout", 1, {
    upgrade(db) {
      db.createObjectStore("exercises", { keyPath: "id" });
      db.createObjectStore("sets", { keyPath: "id" });
      db.createObjectStore("activities", { keyPath: "id" });
      db.createObjectStore("routines", { keyPath: "id" });
      const wg = db.createObjectStore("weeklyGoals");
      // default 0s
      wg.put({ resistance: 0, cardio: 0, mobility: 0, other: 0 }, "current");
    },
  });
  return _db!;
}

export async function setWeeklyGoals(goals: WeeklyGoals) {
  const db = await getDB();
  await db.put("weeklyGoals", goals, "current");
}

export async function getWeeklyGoals(): Promise<WeeklyGoals> {
  const db = await getDB();
  return (await db.get("weeklyGoals", "current")) || {
    resistance: 0,
    cardio: 0,
    mobility: 0,
    other: 0,
  };
}

export async function addActivity(partial: Omit<ActivityLog, "id" | "ts"> & { ts?: number }) {
  const db = await getDB();
  const log: ActivityLog = {
    id: crypto.randomUUID(),
    ts: partial.ts ?? Date.now(),
    name: partial.name || "Activity",
    type: partial.type,
    durationMin: partial.durationMin,
  };
  await db.add("activities", log);
  return log;
}

export async function listActivities(limit = 100) {
  const db = await getDB();
  const all = await db.getAll("activities");
  return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export async function addSet(exerciseName: string, reps: number, weight?: number) {
  const db = await getDB();
  // ensure exercise
  const ex: Exercise = { id: crypto.randomUUID(), name: exerciseName, type: "resistance" };
  // create set
  const set: ExerciseSet = {
    id: crypto.randomUUID(),
    exerciseId: ex.id,
    name: exerciseName,
    ts: Date.now(),
    sets: [{ reps, weight }],
  };
  const tx = db.transaction(["exercises", "sets"], "readwrite");
  await tx.objectStore("exercises").put(ex);
  await tx.objectStore("sets").add(set);
  await tx.done;
  return set;
}

export async function listSets(limit = 100) {
  const db = await getDB();
  const all = await db.getAll("sets");
  return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export async function saveRoutine(name: string) {
  const db = await getDB();
  const routine: Routine = {
    id: crypto.randomUUID(),
    name,
    items: [],
  };
  await db.put("routines", routine);
  return routine;
}

export async function listRoutines() {
  const db = await getDB();
  const all = await db.getAll("routines");
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function clearAll() {
  const db = await getDB();
  const tx = db.transaction(["exercises", "sets", "activities", "routines"], "readwrite");
  await Promise.all([
    tx.objectStore("exercises").clear(),
    tx.objectStore("sets").clear(),
    tx.objectStore("activities").clear(),
    tx.objectStore("routines").clear(),
  ]);
  await tx.done;
}