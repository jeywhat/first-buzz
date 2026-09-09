---
name: ytbuzz-deploy
description: Build and deploy the yt-buzz app to Firebase Hosting (project buzz-party-7894f). Use when the user says deploy, "mettre en ligne", "déploie", "firebase deploy", or after finishing code changes that should go live. ALSO use PROACTIVELY at the end of every completed feature: deploying to Firebase is the automatic final step of each feature.
---

# Deploy yt-buzz to Firebase

Project: `buzz-party-7894f` (see `.firebaserc`). Live URL: https://buzz-party-7894f.web.app

## AUTO-DEPLOY POLICY — deploy at the end of EVERY feature

**Deploying to Firebase is the mandatory final step of every completed feature — do it proactively, without waiting for the user to ask.**

Trigger: a feature is implemented AND verified (`npx vitest run` all green + `npx tsc --noEmit` OK).

Then, in this order:
1. `npm run build` (typechecks + builds).
2. `npx firebase deploy --only hosting`.
3. If `database.rules.json` was modified in the feature → `npx firebase deploy --only database,hosting` instead (rules first-class, same command covers both).
4. Report the Hosting URL and what went live.

Notes:
- The project permission config gates `firebase deploy` behind a user confirmation — that prompt IS the user's sign-off; do not skip the deploy because of it.
- Git commit/push stays manual: only commit/push when the user explicitly asks.
- If verification (tests/typecheck) fails, fix first — never deploy a red state.

## Standard deploy (frontend only)

```powershell
npm run build && npx firebase deploy --only hosting
```

- `npm run build` = `tsc --noEmit && vite build` — it typechecks first; fix type errors before deploying.
- Deploy **hosting only** by default. The RTDB rules (`database.rules.json`) rarely change; only deploy them when they were actually modified:

```powershell
npx firebase deploy --only database
```

## Verification after deploy

- Build output must show `✓ built` with no TS errors.
- Deploy output must end with `+ Deploy complete!` and print the Hosting URL.
- Remind the user to hard-refresh (cached `index.html` is `no-cache`, assets are immutable-hashed, so a normal refresh is enough).

## Firebase CLI notes

- The CLI is already authenticated (`firebase login` done). Non-interactive mode is fine except for prompts — `database:remove` needs `--force`:

```powershell
npx firebase database:remove /rooms/<CODE> --force --project buzz-party-7894f
```

- Never leave test rooms (e.g. `rooms/TEST99`) in the production database — clean them up after debugging.
