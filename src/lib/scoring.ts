import {
  push,
  ref,
  runTransaction,
  set,
} from "firebase/database";
import type { RoomCode, UserId } from "../types";
import { getFirebaseDatabase } from "./firebase";
import { playerScorePath, scoreEventsPath } from "./paths";
import { serverNow } from "./timestamp";

/* ------------------------------------------------------------------ */
/*  Constants & pure helpers                                           */
/* ------------------------------------------------------------------ */

/** Safe durable score range (also mirrored in database.rules.json). */
export const SCORE_MIN = -99;
export const SCORE_MAX = 999;

/** Allowed signed delta per adjustment (mirrored in rules). */
export const MAX_SCORE_DELTA = 20;

/** Deltas with |delta| greater than this require host confirmation. */
export const LARGE_DELTA_THRESHOLD = 3;

export interface ScoreAdjustmentMetadata {
  /** Display-name snapshot of the TARGET player at adjustment time. */
  targetDisplayName: string;
  /** Uid of the host performing the change (event `changedBy`). */
  changedBy: UserId;
  /** Optional free-form reason, max 120 chars. */
  reason: string | null;
  /** Current playback session, null when the room has no active video. */
  videoSessionId: number | null;
  /** Current round number, null when unknown. */
  roundNumber: number | null;
  /** Local UX gate: the caller must be the room host. Rules re-enforce. */
  viewerIsHost: boolean;
}

export interface ScoreEvent {
  eventId: string;
  targetPlayerId: UserId;
  targetDisplayName: string;
  delta: number;
  scoreBefore: number;
  scoreAfter: number;
  reason: string | null;
  changedBy: UserId;
  changedAt: number;
  videoSessionId: number | null;
  roundNumber: number | null;
}

export interface ScoreAdjustResult {
  scoreBefore: number;
  scoreAfter: number;
  eventId: string | null;
  /** True when the score was applied but the audit event write failed. */
  eventWriteFailed: boolean;
}

export function normalizeDelta(raw: number): number {
  if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw new Error("scoring:delta-not-integer");
  }
  if (raw < -MAX_SCORE_DELTA || raw > MAX_SCORE_DELTA) {
    throw new Error("scoring:delta-out-of-range");
  }
  if (raw === 0) throw new Error("scoring:delta-zero");
  return raw;
}

/** Clamped integer next score — the single definition of the clamp. */
export function computeNextScore(
  current: number | null | undefined,
  delta: number,
): number {
  const base = typeof current === "number" && Number.isFinite(current) ? current : 0;
  const next = base + delta;
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(next)));
}

export function isLargeDelta(delta: number): boolean {
  return Math.abs(delta) > LARGE_DELTA_THRESHOLD;
}

/** "+1 point for Alice" / "-2 points for Bob" */
export function formatScoreChange(delta: number, displayName: string): string {
  const n = Math.abs(delta);
  const points = n === 1 ? "1 point" : `${n} points`;
  return `${delta >= 0 ? "+" : "-"}${points} for ${displayName}`;
}

/* ------------------------------------------------------------------ */
/*  Canonical adjustment                                               */
/* ------------------------------------------------------------------ */

/**
 * THE canonical host score mutation.
 *
 * Strategy (honest about atomicity):
 *  1. runTransaction on players/{pid}/score — concurrency-safe, no lost
 *     updates between host tabs, clamped to [SCORE_MIN, SCORE_MAX].
 *  2. scoreBefore is captured inside the transform closure (last transform
 *     run wins, which matches the committed run).
 *  3. THEN a separate push()+set() writes the audit event. This second write
 *     is NOT atomic with the first (client-only RTDB limitation). It is
 *     audit-only: if it fails, the score stays correctly applied, the UI
 *     reflects the durable score, and result.eventWriteFailed=true lets the
 *     caller warn without ever re-applying the delta.
 */
export async function adjustPlayerScore(
  code: RoomCode,
  playerId: UserId,
  delta: number,
  meta: ScoreAdjustmentMetadata,
): Promise<ScoreAdjustResult> {
  if (!meta.viewerIsHost) throw new Error("scoring:host-only");
  const safeDelta = normalizeDelta(delta);
  if (meta.reason && meta.reason.length > 120) {
    throw new Error("scoring:reason-too-long");
  }

  const db = getFirebaseDatabase();
  const scoreRef = ref(db, playerScorePath(code, playerId));

  let before: number | null = null;
  const txResult = await runTransaction(scoreRef, (current) => {
    before = typeof current === "number" ? current : null;
    return computeNextScore(current, safeDelta);
  });
  if (!txResult.committed) throw new Error("scoring:not-committed");

  const scoreBefore = before ?? 0;
  const scoreAfter = txResult.snapshot.val() as number;

  // Audit event — failure here must never re-apply or revert the score.
  let eventId: string | null = null;
  let eventWriteFailed = false;
  try {
    const eventRef = push(ref(db, scoreEventsPath(code)));
    eventId = eventRef.key;
    const event: ScoreEvent = {
      eventId: eventId as string,
      targetPlayerId: playerId,
      targetDisplayName: meta.targetDisplayName,
      delta: safeDelta,
      scoreBefore,
      scoreAfter,
      reason: meta.reason?.trim() ? meta.reason.trim() : null,
      changedBy: meta.viewerIsHost ? meta.changedBy : ("" as UserId),
      changedAt: serverNow(),
      videoSessionId: meta.videoSessionId,
      roundNumber: meta.roundNumber,
    };
    await set(eventRef, event);
  } catch (err) {
    eventWriteFailed = true;
    if (import.meta.env.DEV) console.warn("[scoring] event write failed", err);
  }

  return { scoreBefore, scoreAfter, eventId, eventWriteFailed };
}
