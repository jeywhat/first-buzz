---
name: ytbuzz-debug
description: Debug Firebase/RTDB errors in yt-buzz (auth, Realtime Database writes, security rules). Use when the user reports "Database error", "permission denied", room creation/join failures, or any Firebase-related bug.
---

# Debugging Firebase in yt-buzz

## Step 1 — Read the error message mapping first

`src/lib/errors.ts` (`describeDbError`) maps error codes to messages:

- **"Realtime Database denied the operation…"** → `permission-denied`: rules mismatch. Check `database.rules.json` vs what's deployed; deploy rules with `npx firebase deploy --only database` if the local file is the source of truth.
- **"Database error. Check your connection and Firebase setup."** (generic, no code) → NOT a rules problem. Usually a **client-side crash** (TypeError/ReferenceError) inside the flow that was caught and passed through `describeDbError`. Look for recent changes in the involved components (e.g. temporal-dead-zone bugs: a function called during setup that reads a `let` declared later in the same scope — this exact bug happened in `youtube-player.ts`).
- Auth errors have their own mapper (`describeAuthError`): unauthorized domain, anonymous sign-in disabled, invalid API key…

## Step 2 — Reproduce backend-side with a Node script

The backend is healthy if a plain Node script can do what the app does. Write a temporary `repro-db.mjs` **in the project root** (so `firebase/*` resolves from node_modules), parse `.env` manually, and run the exact failing operations:

```js
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, get, set } from "firebase/database";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
});
const auth = getAuth(app);
const cred = await signInAnonymously(auth);
const db = getDatabase(app);
// ... reproduce the failing get()/set()/update() with the same payload shape
process.exit(0);
```

Run: `node repro-db.mjs`. Print `e.code` and `e.message` on every failure.

**Interpretation**: if the script succeeds, the backend (auth + rules + DB) is fine → the bug is client-side in the app code. If it fails, the code tells you exactly what (rules, missing DB instance, disabled auth…).

## Step 3 — Always clean up

- Delete the repro script after use.
- Delete any test room written to production: `npx firebase database:remove /rooms/TEST99 --force --project buzz-party-7894f` (the `--force` is required in non-interactive mode).
- Note: each anonymous sign-in creates a NEW uid, so rules-protected cleanup (host-only delete) won't work from a fresh script — use the CLI, which bypasses rules.

## Useful context

- databaseURL: `https://buzz-party-7894f-default-rtdb.europe-west1.firebasedatabase.app` (europe-west1).
- Rules enforce: room creation only at the room root with `meta.hostUid === auth.uid`; buzz transitions validated in `game/round` (state machine open → buzzed → cooldown); presence requires room membership.
- `VITE_USE_FIREBASE_EMULATORS` must be `"false"`/unset when testing production.
