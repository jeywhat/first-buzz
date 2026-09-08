---
description: Build and deploy yt-buzz to Firebase Hosting
agent: build
---

Build and deploy the yt-buzz app to Firebase Hosting (project buzz-party-7894f).

Steps:
1. Run `npm run build` (typecheck + vite build). Fix any error before deploying.
2. Run `npx firebase deploy --only hosting`.
3. Report the Hosting URL (https://buzz-party-7894f.web.app) and confirm the release completed.

Only deploy database rules (`--only database`) if `database.rules.json` was modified — confirm with the user first.

$ARGUMENTS
