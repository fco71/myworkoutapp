import "./styles.css";
import { addActivity, addSet, clearAll, getWeeklyGoals, listActivities, listRoutines, listSets, saveRoutine, setWeeklyGoals } from "./db";
import { migrateFromLocalStorage } from "./db/migrate";
import { exportJson, importJson } from "./logic/export";
import { createTimer, formatMMSS } from "./logic/timer";
import { getWeeklyCounts, statusClasses } from "./logic/weekly";

function qs<T extends Element = Element>(sel: string, root: Document | Element = document) {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el as T;
}

function qsa<T extends Element = Element>(sel: string, root: Document | Element = document) {
  return Array.from(root.querySelectorAll(sel)) as T[];
}

async function renderWeeklyHeader() {
  const { counts, goals, rangeLabel } = await getWeeklyCounts();
  qs("#week-range").textContent = rangeLabel;
  qsa<HTMLButtonElement>("#weekly-header .counter").forEach((el) => {
    const type = el.dataset.type!;
    const c = counts[type] ?? 0;
    const g = (goals as any)[type] ?? 0;
    el.textContent = `${type[0].toUpperCase()} ${c}/${g}`;
    el.className = `counter chip ${statusClasses(type, counts, goals)}`;
  });
}

async function renderHistory() {
  const list = qs<HTMLUListElement>("#history-list");
  const [sets, acts] = await Promise.all([listSets(50), listActivities(50)]);
  const items: Array<{ ts: number; text: string }> = [
    ...sets.map((s) => ({ ts: s.ts, text: `Set: ${s.name} — ${s.sets[0]?.reps ?? "?"} reps @ ${s.sets[0]?.weight ?? 0}kg` })),
    ...acts.map((a) => ({ ts: a.ts, text: `Activity: ${a.name} (${a.type})${a.durationMin ? ` — ${a.durationMin}m` : ""}` })),
  ].sort((a, b) => b.ts - a.ts);

  list.innerHTML = items
    .map((i) => `<li class="p-3 rounded-xl bg-neutral-100 flex justify-between"><span>${i.text}</span><span class="text-xs text-neutral-500">${new Date(i.ts).toLocaleString()}</span></li>`)
    .join("");
}

async function renderRoutines() {
  const ul = qs<HTMLUListElement>("#routines-list");
  const routines = await listRoutines();
  ul.innerHTML = routines.length
    ? routines.map((r) => `<li class="p-3 rounded-xl bg-neutral-100">${r.name}</li>`).join("")
    : `<li class="text-neutral-500">No routines yet.</li>`;
}

async function initGoalsUI() {
  const goals = await getWeeklyGoals();
  (qs("#g-resistance") as HTMLInputElement).value = String(goals.resistance ?? 0);
  (qs("#g-cardio") as HTMLInputElement).value = String(goals.cardio ?? 0);
  (qs("#g-mobility") as HTMLInputElement).value = String(goals.mobility ?? 0);
  (qs("#g-other") as HTMLInputElement).value = String(goals.other ?? 0);
}

function installTabs() {
  const buttons = qsa<HTMLButtonElement>('nav [data-tab]');
  buttons.forEach((btn) =>
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.setAttribute("aria-selected", b === btn ? "true" : "false"));
      const tab = btn.dataset.tab!;
      ["today", "routines", "history", "goals"].forEach((t) => {
        const sec = qs<HTMLElement>("#tab-" + t);
        sec.hidden = t !== tab;
      });
    })
  );
}

function installQuickAdd() {
  qsa<HTMLButtonElement>('[data-quick-activity]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      const type = btn.dataset.type as any;
      const name = btn.dataset.quickActivity!;
      await addActivity({ type, name, durationMin: name.includes("Bike") ? 30 : undefined });
      await renderWeeklyHeader();
      await renderHistory();
    })
  );
}

function installResistanceForm() {
  qs("#add-set").addEventListener("click", async () => {
    const name = (qs("#ex-name") as HTMLInputElement).value.trim() || "Exercise";
    const reps = Number((qs("#ex-reps") as HTMLInputElement).value) || 10;
    const weight = Number((qs("#ex-weight") as HTMLInputElement).value) || 0;
    await addSet(name, reps, weight);

    const list = qs("#sets-list");
    const now = new Date().toLocaleTimeString();
    const item = document.createElement("div");
    item.className = "text-sm";
    item.textContent = `${now} — ${name}: ${reps} reps @ ${weight}kg`;
    list.prepend(item);

    await renderWeeklyHeader();
    await renderHistory();
  });
}

function installRoutinesUI() {
  qs("#save-routine").addEventListener("click", async () => {
    const name = (qs("#routine-name") as HTMLInputElement).value.trim();
    if (!name) return;
    await saveRoutine(name);
    (qs("#routine-name") as HTMLInputElement).value = "";
    await renderRoutines();
  });
}

function installGoalsActions() {
  qs("#save-goals").addEventListener("click", async () => {
    const goals = {
      resistance: Number((qs("#g-resistance") as HTMLInputElement).value) || 0,
      cardio: Number((qs("#g-cardio") as HTMLInputElement).value) || 0,
      mobility: Number((qs("#g-mobility") as HTMLInputElement).value) || 0,
      other: Number((qs("#g-other") as HTMLInputElement).value) || 0,
    };
    await setWeeklyGoals(goals);
    await renderWeeklyHeader();
  });

  qs("#reset-all").addEventListener("click", async () => {
    if (!confirm("Delete all local data?")) return;
    await clearAll();
    await renderWeeklyHeader();
    await renderHistory();
    await renderRoutines();
    await initGoalsUI();
  });
}

function installHistoryActions() {
  qs("#export-json").addEventListener("click", () => exportJson());
  qs("#import-file").addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    await importJson(f);
    await renderWeeklyHeader();
    await renderHistory();
    await renderRoutines();
    await initGoalsUI();
    (e.target as HTMLInputElement).value = "";
  });
}

function installTimer() {
  const displayEl = qs("#timer-display");
  const timer = createTimer((sec) => (displayEl.textContent = formatMMSS(sec)));

  const setDisplay = (sec: number) => (displayEl.textContent = formatMMSS(sec));
  qs("#t-30").addEventListener("click", () => setDisplay(30));
  qs("#t-60").addEventListener("click", () => setDisplay(60));
  qs("#t-90").addEventListener("click", () => setDisplay(90));

  const startHandler = () => {
    const [m, s] = displayEl.textContent!.split(":").map((x) => Number(x));
    timer.start(m * 60 + s);
  };
  const stopHandler = () => timer.stop();

  qs("#t-start").addEventListener("click", startHandler);
  qs("#t-stop").addEventListener("click", stopHandler);

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      startHandler();
    }
    if (e.code === "Escape") stopHandler();
  });
}

async function boot() {
  await migrateFromLocalStorage();
  installTabs();
  installQuickAdd();
  installResistanceForm();
  installRoutinesUI();
  installGoalsActions();
  installHistoryActions();
  installTimer();

  await renderWeeklyHeader();
  await renderRoutines();
  await renderHistory();
  await initGoalsUI();
}

boot();