# Mobile media compatibility — manual test matrix

Companion to `src/services/localMediaCompatibilityService.ts` (local, client-only
fallback for browsers that block media autoplay). The automated regression suite
lives in `src/services/localMediaCompatibilityService.test.ts`.

## Hard invariants (check in EVERY cell below)

- [ ] Global Firebase state is unchanged by any local unlock (playback status,
      seq, videoSessionId, round, winner, scores, queue).
- [ ] Desktop-style automatic playback still works when the browser allows it.
- [ ] Video pause is global (a buzz pauses everyone).
- [ ] Player buzz remains authoritative (no local winner).
- [ ] No historical sound replay after an unlock.
- [ ] No overlay covers the YouTube iframe (unlock card is a normal-flow card
      BELOW the player; the inactive error overlay check still holds).
- [ ] No horizontal document overflow.

## Matrix

| # | Environment / scenario | Expectation |
|---|------------------------|-------------|
| 1 | Chrome desktop, normal profile | No unlock UI ever; autoplay works; buzz pause/resume unchanged |
| 2 | Chrome desktop, Incognito | Same as #1 (autoplay usually allowed) |
| 3 | Edge desktop | Same as #1 |
| 4 | Android Chrome, fresh profile | Likely gate on first `playing`: "Tap to start" card below video; one tap syncs video + audio; card disappears with "✓ Started" |
| 5 | Safari iOS (if available) | Same as #4; verify inline playback (playsinline) and no fullscreen hijack |
| 6 | Mobile browser where autoplay IS allowed | NO gate — the automatic attempt succeeds and the client stays transparent |
| 7 | Mobile browser where autoplay IS blocked | Gate appears only after the observed block (≈2s one-shot check), never on viewport size alone |
| 8 | Host desktop + player mobile | Host unaffected; player sees gate only for their own device; no Firebase writes from the tap |
| 9 | Host mobile + player desktop | Host can run the room from mobile; resume/open-next on the buzzer still works after their own local unlock |
| 10 | Two mobile players | Each client gates independently; one player's tap never unlocks another's device |
| 11 | Join an already-playing room | Gate (if blocked) targets the current authoritative position — tapping joins mid-video, correctly seeked |
| 12 | Join a paused room | No video gate; joining a paused room never demands a tap; audio hint may appear |
| 13 | Buzz pause (mobile, playing) | Local pause always works (no gesture needed); winner popup + GET READY unchanged |
| 14 | Host resume (mobile) | Authoritative `playing` arrives; if autoplay blocked → gate re-appears once; tap resumes locally |
| 15 | Video queue switch | Session/seq guards unchanged; stale gate for the old video never opens the new one |
| 16 | Reconnect after offline | `forceResync` behavior unchanged; gate derives from live snapshots, not pre-armed timers |
| 17 | Background then foreground (mobile) | On return, one authoritative snapshot re-syncs; at most one gate; no sound spam |
| 18 | Sound muted/unmuted | Muted audio NEVER gates video; video works with sound off everywhere |
| 19 | 1920×1080 desktop layout | Unlock UI never mounted; buzzer geometry assertion silent |
| 20 | 390×844 mobile layout | Gate card wraps safely; no horizontal overflow; buzzer layout unaffected |

## Dev-only console assertions (desktop-compatible mode)

- `[vb-media] unlock UI mounted in desktop-compatible mode` — must NEVER fire.
- `[vb-media] N YouTube players initialized (expected 1)` — must NEVER fire.
- `[vb-media] N global keyboard handlers (expected 1)` — must NEVER fire.
