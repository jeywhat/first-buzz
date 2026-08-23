# Video Buzzer

Multiplayer video quiz for quiz nights: a host shares a synced YouTube video,
players race to buzz in first on a giant button, and the host judges answers.
Voice answers happen on Discord — this app never handles audio calls.

Stack: Vite + TypeScript · Firebase (Anonymous Auth, Realtime Database,
Hosting) · official YouTube IFrame Player API. No paid services required.

---

## Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | **20 LTS or newer** | `node -v` |
| npm | 10+ (ships with Node) | `npm -v` |
| Firebase CLI | latest | `firebase --version` |

Install the CLI once, globally:

```bash
npm install -g firebase-tools
```

(Or use it without installing via `npx firebase-tools`.)

## Firebase project setup (one time)

1. **Create the project** — [console.firebase.google.com](https://console.firebase.google.com/)
   → *Add project* → pick a name → Google Analytics optional.
2. **Register a Web app** — Project overview → the `</>` icon → nickname →
   *Register app*. Keep the shown config values; they go into `.env` in step 5.
3. **Enable Anonymous sign-in** — Build → **Authentication** → *Get started* →
   **Anonymous** → Enable.
4. **Create a Realtime Database** — Build → **Realtime Database** →
   *Create database* → choose a region → start in **locked mode**. Copy the
   database URL (`https://…firebasedatabase.app`).
5. **Configure environment variables** — copy `.env.example` to `.env` and fill
   every `VITE_FIREBASE_*` value from step 2 (the database URL goes into
   `VITE_FIREBASE_DATABASE_URL`):

   ```bash
   cp .env.example .env
   ```

   These values are public client identifiers by design — access control lives
   in Realtime Database rules, not in hiding them.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:5173. All scripts:

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type-check (strict) then build to `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## Firebase Emulators (offline development)

The repo ships emulator ports in `firebase.json`. To develop without touching
production data:

1. In `.env`, set `VITE_USE_FIREBASE_EMULATORS=true`.
2. Start the suite:

   ```bash
   firebase emulators:start --only auth,database
   ```

3. `npm run dev` as usual — auth and RTDB now hit `localhost:9099/9000`
   (Emulator UI at http://localhost:4000).
4. Rules are enforced by the emulator too, so you can iterate on
   `database.rules.json` safely. Set the flag back to `false` when done.

## Deployment

### One-time project binding

```bash
firebase login
firebase init hosting database
```

Answer the prompts like so: choose **Use an existing project** (or create one
when asked), Hosting public directory → **dist**, single-page app → **Yes**,
GitHub deploys → **No**, and keep the existing `database.rules.json`. If you
skip `init`, copy `.firebaserc.example` to `.firebaserc` and replace
`your-firebase-project-id` with your real project id.

### Build

```bash
npm run build
```

Output lands in `dist/` (type-checked first — the build fails on TS errors).

### Deploy Hosting only

```bash
firebase deploy --only hosting
```

Serves the SPA at `https://<project-id>.web.app`; unknown routes fall back to
`index.html` (see `rewrites` in `firebase.json`).

### Deploy RTDB Rules only

```bash
firebase deploy --only database
```

Always ship rules *before* sharing room links after any rules change.

### Everything at once

```bash
firebase deploy
```

> Do not run deployment commands without a Firebase project you own — every
> command above acts on the id bound in `.firebaserc`.

## Testing with multiple players

Open the deployed URL in one window per player (or share the room link).
Host = whoever creates the room.

**2 players — core loop**
1. A creates a room (YouTube URL + name); B joins via the copied link.
2. A presses Play → B's video follows within ~1 s.
3. B buzzes mid-video → both screens freeze, winner card shows.
4. Host judges "Correct" → B gets +1, video resumes, next round opens.

**3 players — buzz race**
1. C joins; host opens a round (`New round` or console).
2. Two players click BUZZ within the same second → exactly ONE winner is
   shown everywhere; the other sees "Too late".
3. Judge "Wrong answer" → resume without points; then try "Cancel buzz" →
   reopen without scoring.

**5 players — scale & resilience**
1. Five tabs join; scoreboard title shows `5/5 online`.
2. Close one tab → count drops within seconds; record/score remain.
3. Three simultaneous buzzes → still exactly one winner.
4. DevTools→Offline on one client → buzzer disables with "Connection lost";
   back Online → state recovers automatically.
5. Host presses "↻ Resync video" while drifted → everyone re-anchors.

## Known limitations

- **YouTube embedding:** videos whose owner disabled embedding fail with a
  readable message (player error codes 101/150). Age/region-restricted videos
  may also refuse playback.
- **Autoplay policy:** browsers block audible autoplay until the user has
  interacted with the page. The join/create click normally satisfies Chrome
  and Firefox; iOS Safari can require one extra tap per device before remote
  play starts.
- **Latency & fairness:** the winner is whoever's transaction the SERVER
  accepts first, and each browser buffers YouTube differently — two players
  may see slightly different frames at the same moment (see
  "Fairness limitation" below). Perfect cross-browser sync is impossible;
  the goal is a smooth group experience.
- **Free-tier scale:** Spark plan allows ~100 simultaneous RTDB connections —
  ideal for quiz nights, not crowds.
- **Identity:** anonymous uid lives in browser storage; clearing site data
  loses host rights and personal scores.
- **Cleanup:** rooms are never auto-deleted; prune old ones in the console
  using `meta.lastActivityAt`.

## Security checklist (before publishing)

- [ ] `database.rules.json` deployed (`firebase deploy --only database`) and
      tested — signed-out writes must fail.
- [ ] Player cannot write own/others' score; cannot edit another profile.
- [ ] Buzz transition rejected outside an open round or after a winner exists.
- [ ] Closed (`ended`) rooms reject joins; nonexistent codes return null probe.
- [ ] `allowHostToBuzz` defaults to `false` on newly created rooms.
- [ ] `.env` is git-ignored and absent from git history; no service-account
      keys anywhere in the repo.
- [ ] `VITE_USE_FIREBASE_EMULATORS` unset/false in the production environment.
- [ ] `npm audit` shows no high/critical vulnerabilities.

## Pre-deployment manual checklist (every release)

- [ ] Fresh `npm install && npm run build` succeeds.
- [ ] `npm run lint` and `npm test` pass.
- [ ] Local smoke test: create → join → buzz → judge happy path works.
- [ ] Rules changed? Deploy them FIRST and rerun the deny/allow checks above.
- [ ] `firebase deploy --only hosting` → open the live URL in two browsers and
      repeat the 2-player loop against production.
- [ ] Console free of errors; connection badge shows *Connected*.
- [ ] Rollback path known: previous releases listed via
      `firebase hosting:releases` (rollback = `firebase hosting:rollback`).

## Fairness limitation

The winner is whoever's Realtime Database transaction the **server accepts
first** — never the smallest local timestamp. Network latency differs per
player and every browser buffers the YouTube stream differently, so two
players may legitimately see different frames at the same wall-clock moment.
This is inherent without a dedicated low-latency video pipeline and is
accepted for friendly play.
