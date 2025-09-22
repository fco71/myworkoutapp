import { getDB } from "./index";
import type { WeeklyGoals } from "../types";

export async function migrateFromLocalStorage() {
  try {
    const legacy = localStorage.getItem("workoutData");
    if (!legacy) return;
    const parsed = JSON.parse(legacy);

    const db = await getDB();
    const tx = db.transaction(["exercises", "sets", "activities", "routines", "weeklyGoals"], "readwrite");

    if (Array.isArray(parsed.exercises)) {
      for (const e of parsed.exercises) await tx.objectStore("exercises").put(e);
    }
    if (Array.isArray(parsed.sets)) {
      for (const s of parsed.sets) await tx.objectStore("sets").put(s);
    }
    if (Array.isArray(parsed.activities)) {
      for (const a of parsed.activities) await tx.objectStore("activities").put(a);
    }
    if (Array.isArray(parsed.routines)) {
      for (const r of parsed.routines) await tx.objectStore("routines").put(r);
    }
    if (parsed.weeklyGoals) {
      const wg = parsed.weeklyGoals as WeeklyGoals;
      await tx.objectStore("weeklyGoals").put(wg, "current");
    }

    await tx.done;
    localStorage.removeItem("workoutData");
    console.info("[migrate] migrated workoutData from localStorage");
  } catch (e) {
    console.warn("[migrate] nothing to migrate or invalid format", e);
  }
}