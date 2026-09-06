import { onValue, ref, runTransaction, type Unsubscribe } from "firebase/database";
import type { RoomCode, RoundData } from "../types";
import {
  isCooldownExpired,
  RESUME_BUZZ_COOLDOWN_MS,
} from "./buzz-rules";
import { getFirebaseDatabase } from "./firebase";
import { roomRoundPath } from "./paths";
import { serverNow } from "./timestamp";

/**
 * Host-only: closes any current round and opens the next one.
 * round.number is incremented so buzzes/points from old rounds can never be
 * reused against the new one.
 *
 * Post-migration: does NOT touch scores and does NOT start playback. It only
 * clears the previous winner (buzz: null) and re-arms buzzing.
 */
export async function openNextRound(
  code: RoomCode,
  videoSessionId: number | null = null,
): Promise<number> {
  const db = getFirebaseDatabase();
  const result = await runTransaction(ref(db, roomRoundPath(code)), (round: RoundData | null) => {
    const next: RoundData = {
      number: (round?.number ?? 0) + 1,
      state: "open",
      openedAt: serverNow(),
      buzz: null,
      ...(videoSessionId != null ? { videoSessionId } : {}),
    };
    return next;
  });
  return (result.snapshot.val() as RoundData).number;
}

export interface ResumeAndOpenResult {
  /** False when the transition was already done (duplicate click) or rejected. */
  committed: boolean;
  roundNumber: number | null;
}

/**
 * THE canonical host-only "Resume & open buzz" action (used by the host's
 * main mechanical buzzer and every host control labelled "Resume and open
 * next buzz"). Single transaction on the round node:
 *
 *   buzzed -> cooldown : winner cleared, roundNumber incremented EXACTLY
 *   once, server-timestamped cooldown anchor written, videoSessionId
 *   preserved as the new round's fingerprint.
 *
 * Never touches scores, the queue, the active video, /video (playback is
 * resumed separately via the canonical requestPlay once this commits), or
 * the playback session id.
 *
 * Duplicate-safe: a second invocation sees state 'cooldown' and aborts, so
 * rapid clicks / keyboard repeats cannot produce a second transition or an
 * extra roundNumber increment.
 *
 * Rejects (committed: false) when the round belongs to a different playback
 * session (stale videoSessionId mismatch).
 */
export async function resumeAndOpenNextRound(
  code: RoomCode,
  videoSessionId: number | null,
): Promise<ResumeAndOpenResult> {
  const db = getFirebaseDatabase();
  const result = await runTransaction(ref(db, roomRoundPath(code)), (round: RoundData | null) => {
    // Exactly-one-transition guard: only a 'buzzed' round may be resumed.
    if (!round || round.state !== "buzzed") return;
    // Stale-session guard: never reopen a round from a previous video.
    if (
      videoSessionId != null &&
      typeof round.videoSessionId === "number" &&
      round.videoSessionId !== videoSessionId
    ) {
      return;
    }
    const next: RoundData = {
      number: round.number + 1,
      state: "cooldown",
      openedAt: serverNow(),
      cooldownStartedAt: serverNow(),
      buzz: null,
      ...(typeof round.videoSessionId === "number"
        ? { videoSessionId: round.videoSessionId }
        : videoSessionId != null
          ? { videoSessionId }
          : {}),
    };
    return next;
  });
  const round = result.snapshot.val() as RoundData | null;
  return {
    committed: result.committed && round?.state === "cooldown",
    roundNumber: round?.number ?? null,
  };
}

/**
 * Host-only: normalizes an expired cooldown back to 'open' so every client's
 * UI shows BUZZ again from authoritative state. Called by the host client
 * when its server-clock estimate passes the expiry — reconnect-safe because
 * it derives from the live round snapshot, never a pre-armed setTimeout.
 * The attemptBuzz transaction independently accepts cooldown rounds past
 * expiry, so buzzing stays possible even if the host tab is gone.
 */
export async function completeCooldown(code: RoomCode): Promise<boolean> {
  const db = getFirebaseDatabase();
  const result = await runTransaction(ref(db, roomRoundPath(code)), (round: RoundData | null) => {
    if (!round || round.state !== "cooldown") return;
    return { ...round, state: "open", openedAt: serverNow(), cooldownStartedAt: null };
  });
  return result.committed;
}

export type BuzzOutcome = { won: true; round: RoundData } | { won: false };

/**
 * THE race-critical call. Every buzzing client runs a transaction on the same
 * /game/round node; RTDB serializes them so exactly one commit wins.
 *
 * The transaction commits only if the round is still 'open' with no buzz, or
 * in 'cooldown' PAST its expiry (eligibility gate only — see
 * isCooldownExpired). The winner's playerId is bound to the committed round
 * number atomically, so a stale client cannot inject a buzz into a later
 * round. `buzzedAt` uses the SERVER clock — local timestamps never decide
 * the winner.
 */
export async function attemptBuzz(
  code: RoomCode,
  playerId: string,
  displayName: string,
  videoTime: number,
  estimatedServerNow: number = Date.now(),
  cooldownMs: number = RESUME_BUZZ_COOLDOWN_MS,
): Promise<BuzzOutcome> {
  const db = getFirebaseDatabase();
  const result = await runTransaction(ref(db, roomRoundPath(code)), (round: RoundData | null) => {
    if (!round || round.buzz) {
      return; // abort: someone already buzzed or no round
    }
    if (round.state === "open") {
      return {
        ...round,
        state: "buzzed",
        buzz: {
          playerId,
          displayName,
          buzzedAt: serverNow(),
          videoTime,
          roundNumber: round.number,
        },
      } satisfies RoundData;
    }
    if (
      round.state === "cooldown" &&
      isCooldownExpired(round.cooldownStartedAt, estimatedServerNow, cooldownMs)
    ) {
      // Cooldown elapsed (client-estimated server time as a GATE only):
      // first valid buzz flips the round straight to 'buzzed'.
      return {
        ...round,
        state: "buzzed",
        buzz: {
          playerId,
          displayName,
          buzzedAt: serverNow(),
          videoTime,
          roundNumber: round.number,
        },
      } satisfies RoundData;
    }
    return; // abort: round not open / still cooling down
  });

  const round = result.snapshot.val() as RoundData | null;
  return round?.buzz?.playerId === playerId ? { won: true, round } : { won: false };
}

/** Subscribes to round changes. Returns an unsubscribe function. */
export function watchRound(
  code: RoomCode,
  onChange: (round: RoundData) => void,
): Unsubscribe {
  const db = getFirebaseDatabase();
  return onValue(ref(db, roomRoundPath(code)), (snap) => {
    onChange(snap.val() as RoundData);
  });
}
