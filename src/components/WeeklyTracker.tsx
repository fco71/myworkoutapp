import { useMemo, useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Check, Save, Edit, Trash2, MessageSquare, RotateCcw } from "lucide-react";
import { WeeklyPlan } from "@/types";
import {
  cn,
  weekDates,
  toISO,
  loadGlobalTypes,
  loadTypeCategories,
  normalizeWeekly,
} from "@/lib/workout-utils";
import { collection, addDoc, getDocs, query, where, deleteDoc } from "firebase/firestore";

export function WeeklyTracker({
  weekly,
  setWeekly,
  push,
  programStartDate,
  onStartFresh,
  previousWeeks = [],
}: {
  weekly: WeeklyPlan;
  setWeekly: (w: WeeklyPlan) => void;
  push?: (text: string, kind?: 'info'|'success'|'error') => void;
  programStartDate: string;
  onStartFresh: () => Promise<void> | void;
  previousWeeks?: WeeklyPlan[];
}) {
  const types = weekly.customTypes;
  const [typesPanelOpen, setTypesPanelOpen] = useState(false);
  const [editTypeModal, setEditTypeModal] = useState<{ type: string; name: string; category: string } | null>(null);
  const [showProgramSettings, setShowProgramSettings] = useState(false);

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
  const todayISO = toISO(new Date());
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeCategory, setNewTypeCategory] = useState<string>("None");
  const [startFreshPending, setStartFreshPending] = useState(false);

  const handleStartFresh = async () => {
    if (startFreshPending) return;
    setStartFreshPending(true);
    try {
      await onStartFresh();
      setShowProgramSettings(false);
    } finally {
      setStartFreshPending(false);
    }
  };

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
    // Persist new type to current week's state document (Firestore authoritative)
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const ref = doc(db, 'users', uid, 'state', updated.weekOfISO);
        await setDoc(ref, { weekly: updated }, { merge: true });
      } catch (e) {
        console.warn('Failed to save new type to current week state', e);
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
    const updatedWeekly = { ...weekly, customTypes, benchmarks, days, typeCategories: newCats } as WeeklyPlan;
    setWeekly(updatedWeekly);
    // Persist removal to current week's state document only
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const ref = doc(db, 'users', uid, 'state', updatedWeekly.weekOfISO);
        await setDoc(ref, { weekly: updatedWeekly }, { merge: true });
      } catch (e) {
        console.warn('Failed to persist type removal to current week', e);
      }
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
  const updatedWeekly = { ...weekly, customTypes, benchmarks, days, typeCategories: cats } as WeeklyPlan;
  setWeekly(updatedWeekly);
    // Persist rename to current week's state document
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const ref = doc(db, 'users', uid, 'state', updatedWeekly.weekOfISO);
        await setDoc(ref, { weekly: updatedWeekly }, { merge: true });
      } catch (e) {
        console.warn('Failed to persist type rename to current week', e);
      }
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
    <Card className="overflow-hidden bg-white/80 backdrop-blur-sm border-slate-200 shadow-lg">
      <CardHeader className="flex flex-col gap-4 bg-gradient-to-r from-slate-50 to-blue-50 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="text-2xl font-bold text-slate-800 sm:text-2xl">
            Week of {prettyRange}
            {weekly.weekNumber && (
              <span className="mt-1 block text-base font-normal text-slate-600 sm:ml-3 sm:mt-0 sm:inline sm:text-lg">
                (Week {weekly.weekNumber})
              </span>
            )}
          </CardTitle>
          <p className="text-sm text-slate-600">Track what you did each day.</p>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
          <Button variant="outline" className="w-full sm:w-auto" onClick={handleStartFresh} disabled={startFreshPending}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {startFreshPending ? 'Starting...' : 'Start Fresh'}
          </Button>
          <Button variant="secondary" onClick={async () => {
            const uid = auth.currentUser?.uid;
            if (!uid) { push?.('Sign in to save settings', 'info'); return; }
            try {
              await setDoc(doc(db, 'users', uid, 'state', weekly.weekOfISO), { weekly: { benchmarks: weekly.benchmarks, customTypes: weekly.customTypes } }, { merge: true });
              push?.('Weekly settings saved', 'success');
            } catch (e) { console.error('Save settings failed', e); push?.('Failed to save settings', 'error'); }
          }} className="w-full bg-white hover:bg-slate-50 sm:w-auto">
            <Save className="mr-2 h-4 w-4" /> Save settings
          </Button>
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => setShowProgramSettings(true)}>
            Program Settings
          </Button>
          {previousWeeks.length > 0 && (() => {
            const lastWeek = [...previousWeeks].sort(
              (a, b) => new Date(b.weekOfISO).getTime() - new Date(a.weekOfISO).getTime()
            )[0];
            const hasBenchmarks = Object.values(lastWeek.benchmarks || {}).some(v => (v as number) > 0);
            if (!hasBenchmarks) return null;
            return (
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => {
                const updated = { ...weekly, benchmarks: { ...weekly.benchmarks, ...lastWeek.benchmarks } };
                setWeekly(updated);
                push?.('Benchmarks copied from last week', 'success');
              }}>
                Copy last week's goals
              </Button>
            );
          })()}
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
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} placeholder="New type name" className="w-full" />
              <select value={newTypeCategory} onChange={(e) => setNewTypeCategory(e.target.value)} className="w-full rounded border px-2 py-2 sm:w-auto">
                <option>None</option>
                <option>Cardio</option>
                <option>Resistance</option>
                <option>Mindfulness</option>
              </select>
              <Button onClick={addType} className="w-full sm:ml-2 sm:w-auto"><Plus className="mr-2 h-4 w-4"/> Add Type</Button>
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
                    // open the types panel so users discover categorization
                    setTypesPanelOpen(true);
                    // Persist category change to current week's state document
                    (async () => {
                      const uid = auth.currentUser?.uid;
                      if (!uid) return;
                      try { await setDoc(doc(db, 'users', uid, 'state', updated.weekOfISO), { weekly: updated }, { merge: true }); } catch (e) { console.warn('Failed to save categories to current week state', e); }
                    })();
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
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[80px] border-b border-slate-100 bg-white px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Type</th>
                {weekly.days.map((d) => {
                  const isToday = d.dateISO === todayISO;
                  return (
                  <th
                    key={d.dateISO}
                    className={cn(
                      "min-w-[44px] border-b border-slate-100 px-1 py-3 text-center text-xs font-medium sm:min-w-[48px]",
                      isToday ? "bg-blue-50/40 text-blue-600" : "text-slate-500"
                    )}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span>{new Date(d.dateISO + 'T00:00').toLocaleDateString(undefined, { weekday: "short" })}</span>
                      <span className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full text-[11px]",
                        isToday ? "bg-blue-500 font-semibold text-white" : "text-slate-400"
                      )}>
                        {new Date(d.dateISO + 'T00:00').getDate()}
                      </span>
                    </div>
                  </th>
                  );
                })}
                <th className="border-b border-slate-100 px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Total</th>
                <th className="border-b border-slate-100 px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Goal</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => {
                const hit = counts[t] >= (weekly.benchmarks[t] ?? 0);
                return (
                  <tr key={t} className="group/row transition-colors hover:bg-slate-50/70">
                    <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-2 py-2.5 text-sm font-medium transition-colors group-hover/row:bg-slate-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("truncate", hit && "text-emerald-700")}>{t}</span>
                        <div className="flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
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
                      const isToday = d.dateISO === todayISO;
                      return (
                        <td
                          key={`${d.dateISO}-${t}`}
                          className={cn(
                            "group/cell relative border-b border-slate-100 p-1 text-center align-middle transition-colors sm:p-1.5",
                            isToday && "bg-blue-50/40"
                          )}
                        >
                          <div className="flex min-h-[44px] items-center justify-center">
                            <button
                              type="button"
                              aria-label={`${active ? 'Remove' : 'Log'} ${t} for ${new Date(d.dateISO + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`}
                              aria-pressed={active}
                              title={active ? 'Activity logged. Click to remove.' : 'Click to log activity'}
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-150",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-1",
                                active
                                  ? "border border-emerald-200 bg-emerald-50 text-emerald-600 shadow-sm hover:border-emerald-300 hover:bg-emerald-100"
                                  : "text-slate-400 opacity-25 hover:bg-slate-100 hover:text-slate-600 group-hover/cell:opacity-100"
                              )}
                              onClick={async () => {
                              const days = [...weekly.days];
                              const day = { ...days[idx] };
                              const newTypes = { ...day.types, [t]: !active } as Record<string, boolean>;
                              // Note: do NOT auto-toggle 'Cardio' when Bike is toggled to avoid double-counting.
                              // Cardio totals are computed from category mappings (Bike counts toward Cardio in the header),
                              // but we keep the checkboxes independent so the UI reflects exactly what you checked.
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
                              {active ? (
                                <Check className="h-[18px] w-[18px] stroke-[2.5]" />
                              ) : (
                                <Plus className="h-[18px] w-[18px] stroke-2" />
                              )}
                            </button>

                            {/* Comment indicator/button */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className={cn(
                                "absolute bottom-0 right-0 h-4 w-4 rounded p-0 text-slate-400 opacity-0 transition-opacity hover:bg-blue-50 hover:text-blue-600 group-hover/cell:opacity-100",
                                d.comments?.[t] && "text-blue-500 opacity-100"
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                openCommentModal(t, d.dateISO, idx);
                              }}
                              title={d.comments?.[t] ? `Comment: ${d.comments[t]}` : "Add comment"}
                            >
                              <MessageSquare className="h-2.5 w-2.5" />
                            </Button>
                          </div>
                        </td>
                      );
                    })}
                    <td className="border-b border-slate-100 px-2 py-2.5 font-semibold">
                      {(() => {
                        const n = Math.min(7, counts[t]);
                        return <span className={cn("tabular-nums", hit && "text-emerald-700")}>{n} <span className={cn("text-[10px] font-normal text-slate-400", hit && "text-emerald-500")}>{n === 1 ? 'day' : 'days'}</span></span>;
                      })()}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-2.5">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          className={cn(
                            "h-9 w-16 px-2 transition-colors",
                            hit && "border-emerald-300 bg-emerald-50 text-emerald-800"
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
                        <span className="text-[10px] text-slate-400">{(weekly.benchmarks[t] ?? 0) === 1 ? 'day' : 'days'}</span>
                        <span className={cn("flex items-center gap-1 text-xs font-medium", hit ? "text-emerald-600" : "invisible")}>
                          <Check className="h-3.5 w-3.5" /> goal met
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>

      {/* Program Settings Modal */}
      {showProgramSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              Week Count Settings
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Program Start Date
                </label>
                <p className="text-sm text-gray-600 bg-gray-50 rounded-md p-3">
                  {new Date(programStartDate + 'T00:00').toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Currently on Week {weekly.weekNumber}
                </p>
              </div>
              <div className="pt-2 border-t">
                <p className="text-sm text-gray-600 mb-3">
                  Reset the week count to start a new program cycle. This sets the start date to this week's Monday and restarts at Week 1.
                  <strong className="block mt-2">Note: previous data is preserved in your account, but the Previous Weeks section starts over from the new program date.</strong>
                </p>
                <Button
                  variant="outline"
                  onClick={handleStartFresh}
                  className="w-full"
                  disabled={startFreshPending}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {startFreshPending ? 'Starting...' : 'Start Fresh at Week 1'}
                </Button>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setShowProgramSettings(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

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
