# Weekly Firestore Handoff

Date: 2026-08-11
Repo: `/Users/fco/Documents/websites_local/workout-app`

## User Issue

The Weekly Tracker is showing an empty/default week instead of retrieving the user's saved weekly data from Firestore.

The user also reported this console warning:

```text
The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page.
```

That warning appears unrelated to Firestore loading. It comes from Web Audio autoplay restrictions.

## Current Git State

Only one source file is modified:

```text
M src/WorkoutTrackerApp.tsx
```

No commit has been made for this investigation yet.

## What Was Found

The risky loading path is in `src/WorkoutTrackerApp.tsx`.

The app currently looks up the exact current-week document:

```text
users/{uid}/state/{currentWeekISO}
```

If that doc is missing, stale, empty, or fails to load, the app can fall back to a default weekly plan. Once `initialized` becomes true, the autosave effect can write that default plan back to Firestore. That matches the symptom: the tracker appears reset to an empty default week.

The local-date fix from commit `2ddde72` changed date formatting from UTC to local calendar fields. In `America/Santo_Domingo`, that fixed evening day rollover, but it also made the current-week document lookup stricter about local week keys. If old data was saved under a different key, the app may not find it.

I could not inspect live Firestore directly:

- Firebase CLI credentials are expired: `firebase login --reauth` is required.
- The in-app browser session available to Codex is not signed in (`window.appAuth?.currentUser` was null).
- Chrome/external browser bindings were unavailable in this environment.

## Code Changes Currently Applied

All current changes are in `src/WorkoutTrackerApp.tsx`.

Implemented:

1. Server-forced reads for weekly state:

```ts
getDocFromServer(...)
getDocsFromServer(...)
```

This avoids trusting stale local Firestore cache for the weekly plan.

2. Current-week session recovery:

New helpers:

```ts
hasWeeklyActivity(...)
dateFromFirestoreValue(...)
getSessionDateISO(...)
loadCurrentWeekSessions(...)
mergeWeeklyWithSessions(...)
```

If weekly state is missing/empty but saved session docs exist for the current week, the app rebuilds the weekly grid from `users/{uid}/sessions` docs.

3. Autosave guard:

Added:

```ts
const weeklyLoadReadyRef = useRef(false);
```

Autosave now returns early unless the weekly load path completed successfully:

```ts
if (!userId || !initialized || !weeklyLoadReadyRef.current) return;
```

4. Failed-load behavior:

If the weekly state load fails completely, the app shows an error toast and does not mark weekly load as ready. This is meant to prevent saving defaults over Firestore data.

Toast text:

```text
Could not load weekly data from Firestore. Not saving defaults over it.
```

## Verification Already Run

Build passes:

```bash
npm run build
```

Unauthenticated local runtime was checked in the in-app browser:

- Page renders.
- No Vite/framework error overlay.
- No console errors.
- It shows defaults because the browser session is not signed in.

Dev server was started with escalation because the sandbox blocked binding to `127.0.0.1:8000`:

```bash
npm run dev -- --host 127.0.0.1
```

The server was stopped afterward.

Generated `firebase-debug.log` was restored. It is not part of the current diff.

## Important Caveats

The recovery query currently uses:

```ts
where('dateISO', 'in', currentWeekDates)
```

This only recovers sessions that have a `dateISO` field. Most app-created sessions should have it. If older sessions only have `completedAt`/`ts` and no `dateISO`, this query will not recover them.

A more complete recovery could query recent completed sessions by `completedAt` range and filter client-side, but that may require index/rules consideration.

`mergeWeeklyWithSessions` adds `Cardio` when session types include `Bike`, matching older workout-completion behavior. The manual weekly toggle path intentionally does not auto-toggle Cardio.

## Recommended Next Steps

1. Review the diff in `src/WorkoutTrackerApp.tsx`.

2. If possible, sign into Firebase CLI:

```bash
firebase login --reauth
```

Then inspect the user's Firestore `state` document IDs and current week doc content.

3. Test in the user's signed-in browser session, not the unsigned Codex in-app browser.

Helpful browser console snippets once signed in:

```js
window.appAuth?.currentUser?.uid
```

```js
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const day = d.getDay();
const diff = (day === 0 ? -6 : 1) - day;
const monday = new Date(d);
monday.setDate(d.getDate() + diff);
monday.setHours(0, 0, 0, 0);
`${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
```

4. Confirm whether saved data exists under:

```text
users/{uid}/state/{currentWeekISO}
users/{uid}/state/tracker
users/{uid}/sessions
```

5. If current week data exists under a different week key, decide whether to migrate/copy it or add a compatibility lookup.

6. Run:

```bash
npm run build
```

7. After signed-in verification, commit and deploy if the fix works.

## Files To Focus On

- `src/WorkoutTrackerApp.tsx`: auth load, weekly state retrieval, fallback logic, autosave guard.
- `src/lib/workout-utils.ts`: local date helpers, `defaultWeekly`, `normalizeWeekly`.
- `src/components/WeeklyTracker.tsx`: manual toggle persistence.
- `src/components/WorkoutView.tsx`: workout completion persistence into sessions and weekly state.

## Last Known Good Commands

```bash
git status --short
npm run build
```

Current expected status before continuation:

```text
M src/WorkoutTrackerApp.tsx
?? WEEKLY_FIRESTORE_HANDOFF.md
```
