import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { deleteField, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB7OR5aBzZ8N4d7BaB_HlZoFfWGegG7Fvg",
  authDomain: "fcoworkout.firebaseapp.com",
  projectId: "fcoworkout",
  storageBucket: "fcoworkout.firebasestorage.app",
  messagingSenderId: "939615720328",
  appId: "1:939615720328:web:d60687e4e617d0d3b5203d",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  // Optional fields (startedAt, completedAt, ...) are often explicitly `undefined` in app
  // state. Without this, Firestore rejects the whole write, e.g. saving a reopened workout.
  ignoreUndefinedProperties: true,
});

// For `setDoc(..., { merge: true })` writes: turn top-level `undefined` fields into
// deleteField() so a cleared value (like startedAt after reopening) is removed from the
// stored document instead of the old value surviving the merge.
export function withClearedFields<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = v === undefined ? deleteField() : v;
  }
  return out as T;
}


