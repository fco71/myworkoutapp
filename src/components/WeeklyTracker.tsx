import { useMemo, useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Check, Save, Edit, Trash2, MessageSquare } from "lucide-react";
import { WeeklyPlan } from "@/types";
import {
  cn,
  weekDates,
  toISO,
  getMonday,
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
  setProgramStartDate,
  previousWeeks = [],
}: {
  weekly: WeeklyPlan;
  setWeekly: (w: WeeklyPlan) => void;
  push?: (text: string, kind?: 'info'|'success'|'error') => void;
  programStartDate: string;
  setProgramStartDate: (d: string) => void;
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
    <Card className="bg-white/80 backdrop-blur-sm border-slate-200 shadow-lg">
      <CardHeader className="flex items-center justify-between bg-gradient-to-r from-slate-50 to-blue-50">
        <div>
          <CardTitle className="text-2xl font-bold text-slate-800">
            Week of {prettyRange}
            {weekly.weekNumber && (
              <span className="ml-3 text-lg font-normal text-slate-600">
                (Week {weekly.weekNumber})
              </span>
            )}
          </CardTitle>
          <p className="text-sm text-slate-600">Click cells to toggle what you did each day.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => {
            // Reset to current week
            const currentMon = getMonday();
            const currentWeekISO = toISO(currentMon);
            const currentWeekDates = weekDates(currentMon).map(d => toISO(d));

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

            setWeekly(newWeekly);
            push?.('Reset to current week', 'success');
          }}>
            Reset to Current Week
          </Button>
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
          <Button variant="outline" onClick={() => setShowProgramSettings(true)}>
            Program Settings
          </Button>
          {previousWeeks.length > 0 && (() => {
            const lastWeek = [...previousWeeks].sort(
              (a, b) => new Date(b.weekOfISO).getTime() - new Date(a.weekOfISO).getTime()
            )[0];
            const hasBenchmarks = Object.values(lastWeek.benchmarks || {}).some(v => (v as number) > 0);
            if (!hasBenchmarks) return null;
            return (
              <Button variant="outline" onClick={() => {
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
                <th className="sticky left-0 z-10 bg-white text-left p-1 sm:p-2 border-b text-sm min-w-[80px]">Type</th>
                {weekly.days.map((d) => (
                  <th key={d.dateISO} className="p-1 sm:p-2 text-xs font-medium border-b min-w-[36px] text-center">
                    {new Date(d.dateISO + 'T00:00').toLocaleDateString(undefined, { weekday: "short" })}
                    <div className="text-[10px] text-neutral-500">{new Date(d.dateISO + 'T00:00').getDate()}</div>
                  </th>
                ))}
                <th className="p-1 sm:p-2 text-left border-b text-xs sm:text-sm">Total</th>
                <th className="p-1 sm:p-2 text-left border-b text-xs sm:text-sm">Goal</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => {
                const hit = counts[t] >= (weekly.benchmarks[t] ?? 0);
                return (
                  <tr key={t} className="">
                    <td className="sticky left-0 z-10 bg-white p-1 sm:p-2 font-medium border-b text-sm">
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
                            "p-1 sm:p-2 text-center align-middle border-b cursor-pointer relative hover-parent",
                            active && "bg-green-100/70"
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
                                "opacity-20 hover:!opacity-100",
                                "[.hover-parent:hover_&]:opacity-60",
                                d.comments?.[t] && "!opacity-100 text-blue-600 bg-blue-50"
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
                        <span className={cn("text-xs flex items-center gap-1", hit ? "text-green-700" : "invisible")}>
                          <Check className="h-4 w-4" /> goal met
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
                  Reset the week count to start a new program cycle. This will set the start date to this week's Monday and restart at Week 1.
                  <strong className="block mt-2">Note: All your previous weeks' data will be preserved and remain visible in the Previous Weeks section.</strong>
                </p>
                <Button
                  variant="outline"
                  onClick={async () => {
                    const newStartDate = toISO(getMonday(new Date()));
                    setProgramStartDate(newStartDate);
                    setWeekly({
                      ...weekly,
                      weekNumber: 1
                    });
                    // Save to Firestore (data is preserved, only start date changes)
                    const uid = auth.currentUser?.uid;
                    if (uid) {
                      await setDoc(doc(db, 'users', uid, 'settings', 'program'), {
                        programStartDate: newStartDate
                      }, { merge: true });
                    }
                    if (push) push('Week count reset to 1. All previous data preserved!', 'success');
                    setShowProgramSettings(false);
                  }}
                  className="w-full"
                >
                  Reset to Week 1
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
