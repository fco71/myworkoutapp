import { getDB } from "../db";

export async function exportJson() {
  const db = await getDB();
  const [ex, se, ac, ro, wg] = await Promise.all([
    db.getAll("exercises"),
    db.getAll("sets"),
    db.getAll("activities"),
    db.getAll("routines"),
    db.get("weeklyGoals", "current"),
  ]);
  const blob = new Blob([JSON.stringify({ exercises: ex, sets: se, activities: ac, routines: ro, weeklyGoals: wg || {} }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `myworkout-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function importJson(file: File) {
  const text = await file.text();
  const data = JSON.parse(text);
  const db = await getDB();
  const tx = db.transaction(["exercises", "sets", "activities", "routines", "weeklyGoals"], "readwrite");
  if (Array.isArray(data.exercises)) for (const e of data.exercises) await tx.objectStore("exercises").put(e);
  if (Array.isArray(data.sets)) for (const s of data.sets) await tx.objectStore("sets").put(s);
  if (Array.isArray(data.activities)) for (const a of data.activities) await tx.objectStore("activities").put(a);
  if (Array.isArray(data.routines)) for (const r of data.routines) await tx.objectStore("routines").put(r);
  if (data.weeklyGoals) await tx.objectStore("weeklyGoals").put(data.weeklyGoals, "current");
  await tx.done;
}