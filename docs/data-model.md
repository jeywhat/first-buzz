# Realtime Database data model

Room codes are 6 characters from an unambiguous alphabet (`A–Z` minus `I, L, O`,
`2–9` minus `0, 1`). All event timestamps use `ServerValue.TIMESTAMP`.

## Structure

```
/rooms/{roomId}
  meta/
    hostUid        string   — set once at creation, immutable
    createdAt      number   — serverTimestamp
    lastActivityAt number   — serverTimestamp; bumped on activity (manual cleanup hook)
    allowHostToBuzz boolean — whether the host may also buzz (default false)
  video/
    videoId         string  — YouTube ID selected at creation
    playing         boolean — authoritative play/pause flag (host-only writes)
    currentTimeSec  number  — position at the moment of the change
    changedAt       number  — serverTimestamp of the change
    changedBy       string  — uid of who made the change
    seq             number  — monotonic; clients ignore seq <= lastApplied
  game/
    status         'lobby' | 'active' | 'ended'
    round/
      number       number   — incrementing; stale events cannot be reused
      state        'idle' | 'open' | 'buzzed' | 'resolved' | 'finished'
      openedAt     number   — serverTimestamp
      buzz/                 — exists only after first buzz
        playerId     string  — winner's uid (authoritative identity)
        displayName  string  — copied at buzz time for cheap rendering
        buzzedAt     number  — serverTimestamp (THE authoritative buzz order)
        videoTime    number  — video position captured locally at buzz
        roundNumber  number  — audit copy of round.number
      result       'correct' | 'wrong' | null
      pointsAwarded  number
  players/{uid}/
    profile/ { name, color } — written by that player
    joinedAt       number   — serverTimestamp, set once by the player
    score          number   — HOST-only writes; absent (= 0) until first award

/presence/{roomId}/{uid}
  displayName       string  — denormalized for participant rendering
  isOnline          boolean — CANONICAL live presence flag (owner-written)
  connectedAt       number  — serverTimestamp of the last successful connect
  lastSeenAt        number  — serverTimestamp, heartbeat every 20s + on writes
  lastDisconnectedAt number | null — serverTimestamp set by onDisconnect()
  sessionId         string  — crypto.randomUUID(), one per page load
```

Notes:
- A room starts with `round.state = 'idle'`, so nobody can buzz in the lobby.
- Playback sync policy: the host writes `/video` only on explicit actions
  (play / pause / seek / restart), once on each client at startup, and via an
  optional 10 s heartbeat while playing. There is no continuous syncing.
  Clients never write back what they receive; the monotonic `seq` filters
  echoes and out-of-order snapshots. Expected position is derived from
  `currentTimeSec + elapsed server time since changedAt` while playing.
- `round.number` lives inside `round` so the buzz transaction binds winner +
  round atomically.
- `score` may be absent before the first award; readers coalesce with `?? 0`
  and `adjustScore()` uses a transaction starting from `current ?? 0`.

## Visibility contract (for the final security rules)

No `.read: true` or `.write: true` anywhere. Everything requires
`auth != null`. Current placeholder rules deny everything.

| Location | Read | Write |
|---|---|---|
| `/rooms/{id}/meta/hostUid`, `createdAt` | authenticated | creator only, only if absent |
| `/rooms/{id}/meta/lastActivityAt` | authenticated | any authenticated (validated number) |
| `/rooms/{id}/video/**` | authenticated | **host only** (`auth.uid == meta/hostUid`) |
| `/rooms/{id}/game/status` | authenticated | **host only** |
| `/rooms/{id}/game/round/**` | authenticated | **host only**, EXCEPT one transition: any player may write round iff old `state == 'open'`, no existing `buzz`, new `state == 'buzzed'`, `newData.buzz.playerId == auth.uid`, `newData.buzz.roundNumber == data.number`, and (`meta.allowHostToBuzz == true` or the writer is not the host) |
| `/rooms/{id}/players/{uid}/profile`, `joinedAt` | authenticated | **that uid only** (`joinedAt` only if absent) |
| `/rooms/{id}/players/{uid}/score` | authenticated | **host only** |
| `/presence/{roomId}/{uid}` | authenticated | **that uid only** |

Race safety: buzzing clients all run a transaction on `/game/round`; RTDB
serializes transactions, so exactly one commit wins regardless of client
latency. Rules re-validate the final committed state, so even a malicious
client cannot create two winners or buzz into a closed/old round.

Cleanup: rooms are never auto-deleted (no paid services / Cloud Functions).
Manual cleanup = delete `/rooms/{id}` where `meta/lastActivityAt` is older
than a chosen cutoff.

## Final rules (v2) — deltas vs. the table above

Deployed via `firebase deploy --only database`.

- **Member-gated reads:** full room data is readable only by the host or by
  uids with a `players/{uid}` record. Exception: `game/status` is readable by
  any authenticated user so non-members can probe existence / closed state
  before joining.
- **Room deletion:** the host may remove `/rooms/{roomId}` entirely (root
  write allows create-by-host or delete-by-host, nothing else).
- **Join gating:** profile/joinedAt writes require the room to exist and its
  status ≠ `ended`. Presence writes additionally require an existing player
  record (presence always follows join in app flow).
- **Key validation:** `$roomId` must match the unambiguous code alphabet
  (`[A-HJ-KM-NP-Z2-9]{6}`), enforced inside read/write expressions since
  wildcards cannot `.validate` their own key.
- **Value validations:** displayName 1–24 chars; color `#RRGGBB`; scores are
  integers within ±10 000; pointsAwarded 0–1000 integer; round number ≥ 0;
  video/currentTime/videoTime numeric in [0, 86400]; seq ≥ 0; enums for
  `game.status`, `round.state`, `result`; booleans where boolean.
- Remember: deletions skip `.validate`, and rules cannot rate-limit buzz
  attempts — client locks + transaction semantics carry that load.
