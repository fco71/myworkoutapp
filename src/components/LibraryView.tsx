import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc, collection, addDoc, getDocs, deleteDoc, getDoc, collectionGroup, query, where } from "firebase/firestore";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Check, Edit, Search, Dumbbell, User, Grid3X3, Target, Bookmark, MessageSquare } from "lucide-react";
import { ResistanceExercise, ResistanceSession } from "@/types";
import {
  cn,
  toISO,
  useToasts,
} from "@/lib/workout-utils";

export function LibraryView({ userName, onLoadRoutine }: { userName: string | null; onLoadRoutine: (s: ResistanceSession, mode?: 'replace'|'append') => void }) {
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
      if (!uid) {
        // Not signed in: load public content based on filter type
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

          } catch (e) {
            console.error('Failed to load public content for unsigned user - INDEX ERROR:', e);
          }
        }

        // Apply favorites filter (will be empty for unsigned users)
        data = data.map(it => ({ ...it, favorite: false }));

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
        data = data.filter(it => {
          const key = `${it.kind||'routine'}::${it.id}`;
          const isFav = currentFavs.has(key);
          return isFav;
        });
      }
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
              const favKey = `${data.itemType||'routine'}::${data.itemId}`;
              favSet.add(favKey);
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
                          toasts.push(`Loaded "${it.name}" and opened Workout Session.`, 'success');
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
                          toasts.push(`Added ${exercises.length} exercise${exercises.length === 1 ? '' : 's'} from "${it.name}".`, 'success');
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
                          toasts.push(`Added "${it.name}" to the current workout.`, 'success');
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
