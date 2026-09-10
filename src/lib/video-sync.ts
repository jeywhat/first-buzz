import type { VideoState } from "../types";

/** Default maximum tolerated drift before a client seeks (seconds). */
const DEFAULT_DRIFT_TOLERANCE_SEC = 0.75;

/**
 * Drift threshold, configurable via VITE_SYNC_DRIFT_TOLERANCE_SEC.
 * Missing or invalid values fall back to the default.
 */
export function getDriftToleranceSec(): number {
  const raw = import.meta.env.VITE_SYNC_DRIFT_TOLERANCE_SEC;
  const parsed = typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DRIFT_TOLERANCE_SEC;
}

/** Stale-event guard: only strictly newer sequences get applied. */
export function isStaleSequence(seq: number, appliedSeq: number): boolean {
  return seq <= appliedSeq;
}

/**
 * Where playback should be at `nowServerMs` (server clock) given an
 * authoritative state. Paused playback stays frozen at the stored position.
 */
export function computeExpectedPositionSec(
  state: VideoState,
  nowServerMs: number,
): number {
  if (!state.playing) return state.currentTimeSec;
  // Clock skew between writer and reader must never move time backwards.
  const elapsedMs = Math.max(0, nowServerMs - state.changedAt);
  return state.currentTimeSec + elapsedMs / 1000;
}

/** Clients seek only when the local player drifted beyond the tolerance. */
export function shouldSeekTo(
  currentSec: number,
  targetSec: number,
  toleranceSec: number = getDriftToleranceSec(),
): boolean {
  return Math.abs(currentSec - targetSec) > toleranceSec;
}

/* ------------------------------------------------------------------ */
/*  Paused anchoring (YouTube IFrame API hazard)                       */
/* ------------------------------------------------------------------ */

/* YT.PlayerState codes (numeric to avoid depending on the YT global here). */
const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_BUFFERING = 3;

export type PausedAnchorAction =
  | { kind: "none" }
  | { kind: "pause-in-place" }
  | { kind: "seek"; positionSec: number }
  | { kind: "cue"; positionSec: number };

/**
 * Plans how to anchor an existing player to a PAUSED authoritative state
 * WITHOUT ever starting playback.
 *
 * Why this exists: the IFrame API contract says `seekTo()` "will play the
 * video" when called from any state other than PAUSED — `video cued` (5)
 * and `unstarted` (-1) included. A late joiner's freshly-created player is
 * CUED at 0, so the naive `seekTo(currentTimeSec)` silently started the
 * video while the host's room was paused. The safe mapping is:
 *  - currently playing/buffering → pause in place (position is authoritative);
 *  - already at the target → nothing;
 *  - genuinely paused elsewhere → seek (PAUSED is the only state that stays
 *    paused through `seekTo`);
 *  - cued / unstarted / ended → re-cue at the target (never fetches/plays).
 */
export function planPausedAnchor(
  playerState: number,
  currentSec: number | null,
  targetSec: number,
  toleranceSec = 0.05,
): PausedAnchorAction {
  if (playerState === YT_PLAYING || playerState === YT_BUFFERING) {
    return { kind: "pause-in-place" };
  }
  if (currentSec !== null && Math.abs(currentSec - targetSec) <= toleranceSec) {
    return { kind: "none" };
  }
  if (playerState === YT_PAUSED) {
    return { kind: "seek", positionSec: targetSec };
  }
  return { kind: "cue", positionSec: targetSec };
}
