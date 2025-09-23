// print-expected-firestore.cjs
// Print expected Firestore document paths and example JSON for manual smoke tests.

const crypto = require('crypto');

function genId() { return crypto.randomUUID(); }
function now() { return Date.now(); }

const args = process.argv.slice(2);
const uid = args[0] || 'TEST_UID';
const routineId = args[1] || genId();
const exerciseId = args[2] || genId();
const sessionId = args[3] || genId();
const weekOfISO = args[4] || new Date().toISOString().slice(0,10);

console.log('\nExpected Firestore writes (example shapes)\n');

console.log('1) Routine (users/{uid}/routines/{routineId})');
console.log('path:', `users/${uid}/routines/${routineId}`);
console.log('example:');
console.log(JSON.stringify({
  name: 'Legs',
  exercises: [{ name: 'Squat', minSets: 3, targetReps: 6 }],
  sessionTypes: ['Resistance'],
  createdAt: now(),
  public: false,
  owner: uid,
  ownerName: 'test@example.com'
}, null, 2));

console.log('\n2) Exercise (users/{uid}/exercises/{exerciseId})');
console.log('path:', `users/${uid}/exercises/${exerciseId}`);
console.log('example:');
console.log(JSON.stringify({ name: 'Face Pull', minSets: 3, targetReps: 12, createdAt: now(), public: false, owner: uid, ownerName: 'test@example.com' }, null, 2));

console.log('\n3) Favorite (users/{uid}/favorites/{favId})');
console.log('path:', `users/${uid}/favorites/routine::${routineId}`);
console.log('example:');
console.log(JSON.stringify({ itemType: 'routine', itemId: routineId, createdAt: now() }, null, 2));

console.log('\n4) Session (users/{uid}/sessions/{sessionId})');
console.log('path:', `users/${uid}/sessions/${sessionId}`);
console.log('example:');
console.log(JSON.stringify({ sessionName: 'Legs', exercises: [{ name: 'Squat', sets: [5,5,5] }], sessionTypes: ['Resistance'], completedAt: now(), durationSec: 1800 }, null, 2));

console.log('\n5) Weekly state (users/{uid}/state/{weekOfISO})');
console.log('path:', `users/${uid}/state/${weekOfISO}`);
console.log('example:');
console.log(JSON.stringify({ weekly: { weekOfISO: weekOfISO, weekNumber: 1, days: [ { dateISO: weekOfISO, types: { Resistance: true }, sessions: 1, sessionsList: [{ id: sessionId, sessionTypes: ['Resistance'] }] } ], benchmarks: { Resistance: 2 }, customTypes: ['Resistance'] } }, null, 2));

console.log('\nNotes:');
console.log('- favId pattern: "{itemType}::{itemId}" (e.g., "routine::abc123").');
console.log('- Use the printed paths to locate docs in Firebase console or emulator.');
console.log('- To run: node scripts/print-expected-firestore.cjs <uid> [routineId] [exerciseId] [sessionId] [weekOfISO]');
console.log('\n');
