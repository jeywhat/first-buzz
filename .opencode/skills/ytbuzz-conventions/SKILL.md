---
name: ytbuzz-conventions
description: yt-buzz architecture invariants, write-path rules, and verification commands. Use BEFORE editing src/ in this project — especially main.ts, buzz-panel.ts, buzz-popup.ts, youtube-player.ts, buzz-rules.ts — and when adding buzzer states or Firebase writes.
---

# yt-buzz conventions & invariants

Stack: vanilla TypeScript + Vite, Firebase Auth (anonymous) + Realtime Database. No framework. Tests: vitest (+ happy-dom for DOM components).

## Non-negotiable invariants

1. **One canonical write path per action.** All host resume/open-next writes funnel through `doResume()` in `src/main.ts` → `resumeAndOpenNextRound()` (`src/lib/rounds.ts`). All buzzes through `doBuzz()` → `attemptBuzz()`. Never add a second write path from a UI component; components only render state and call the injected callback.
2. **Server-anchored time only.** Decisions never trust local clocks: writes use `serverNow()` (`src/lib/timestamp.ts`), eligibility gates compare `serverTimestamp + constant` against a client-estimated server clock (`Date.now() + /.info/serverTimeOffset`). Follow the existing pattern in `src/lib/buzz-rules.ts` (`isCooldownExpired`, `isResumeDelayExpired`) — pure, testable, fail-open/fail-closed documented per function.
3. **Buzzer geometric stability.** The mechanical buzzer (`.vb-mechanical-buzzer`) must keep the exact same position/size across ALL round states. Never add conditional DOM inside `.vb-mechanical-buzzer-zone`; round metadata (winner card, pills) lives ONLY in `.vb-buzz-popup-region`. DEV assertions in `main.ts` (`checkBuzzerGeometry`) will scream if you break this.
4. **New buzzer visual state = 4 places.** Add to `BuzzerVisualState` union (`buzz-panel.ts`), the render() branch chain, CSS `[data-state="…"]` in `src/ui/styles.css` (dome styling, geometry unchanged), and tests in `buzz-panel.test.ts`.
5. **youtube-player.ts setup order (TDZ trap).** `ready`, `player`, `draggingRef` etc. are declared in the "Player lifecycle" section, AFTER the host-controls/volume DOM setup. Never call a function during setup that reads those variables — it throws a temporal-dead-zone ReferenceError at runtime (tsc will NOT catch it). This caused a real production bug ("Database error" on room creation). Regression test: `youtube-player.test.ts`.
6. **Volume/playback split.** Playback state flows through Firebase (`/video`, seq-guarded). Local loudness (`setVolume`) is per-client and NEVER written to Firebase.
7. **Video shell.** Never clip/transform `.vb-video-frame` ancestors (black-video bug); overlays must be created/removed, never toggled via `[hidden]` with CSS display conflicts.

## Verification (run after any change)

```powershell
npx vitest run        # all tests must pass
npx tsc --noEmit      # typecheck (part of npm run build too)
npx eslint <changed files>
```

Test conventions: colocated `*.test.ts`; DOM tests start with `// @vitest-environment happy-dom`; pure logic (buzz-rules, video-sync, youtube helpers) gets plain vitest tests; use `vi.useFakeTimers()` for timer-driven UI (resume lockout flip).

## Deploy

See the `ytbuzz-deploy` skill: `npm run build && npx firebase deploy --only hosting`.
