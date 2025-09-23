// verify-library-emulator.cjs
// Verifies expected Firestore documents exist in the emulator for a given uid.
// Usage: FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/verify-library-emulator.cjs <uid> [routineId] [exerciseId] [sessionId] [weekOfISO]

const args = process.argv.slice(2);
const uid = args[0];
if (!uid) {
  console.error('Usage: FIRESTORE_EMULATOR_HOST=host:port node scripts/verify-library-emulator.cjs <uid> [routineId] [exerciseId] [sessionId] [weekOfISO]');
  process.exit(1);
}
const routineId = args[1] || null;
const exerciseId = args[2] || null;
const sessionId = args[3] || null;
const weekOfISO = args[4] || null;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST not set. Start the Firestore emulator and set FIRESTORE_EMULATOR_HOST before running.');
  process.exit(1);
}

let admin;
try {
  admin = require('firebase-admin');
} catch (e) {
  console.error('firebase-admin not installed. Run: npm install --save-dev firebase-admin');
  process.exit(1);
}

// Initialize admin app to use emulator
const projectId = process.env.FIREBASE_PROJECT_ID || 'demo-project';
process.env.GOOGLE_CLOUD_PROJECT = projectId;

try {
  admin.initializeApp({ projectId });
} catch (e) {
  // ignore if already initialized
}

const db = admin.firestore();

async function head(path) {
  try {
    const ref = db.doc(path);
    const snap = await ref.get();
    return snap.exists ? snap.data() : null;
  } catch (e) {
    return { __error: String(e) };
  }
}

(async () => {
  console.log('Verifying expected documents in emulator for uid=', uid);
  const checks = [];
  if (routineId) checks.push(`users/${uid}/routines/${routineId}`);
  if (exerciseId) checks.push(`users/${uid}/exercises/${exerciseId}`);
  if (sessionId) checks.push(`users/${uid}/sessions/${sessionId}`);
  if (weekOfISO) checks.push(`users/${uid}/state/${weekOfISO}`);
  // Always check favorites collection for presence (non-exhaustive)
  checks.push(`users/${uid}/favorites/routine::${routineId || 'SAMPLE'}`);

  for (const p of checks) {
    console.log('\nChecking', p);
    const data = await head(p);
    if (!data) console.log('  MISSING');
    else if (data.__error) console.log('  ERROR', data.__error);
    else console.log('  FOUND (sample):', JSON.stringify(data, null, 2).slice(0, 1000));
  }
  console.log('\nDone.');
  process.exit(0);
})();
