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
