import { onValue, ref, runTransaction, type Unsubscribe } from "firebase/database";
import type { RoomCode, RoundData } from "../types";
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
export async function openNextRound(code: RoomCode): Promise<number> {
  const db = getFirebaseDatabase();
  const result = await runTransaction(ref(db, roomRoundPath(code)), (round: RoundData | null) => {
    const next: RoundData = {
      number: (round?.number ?? 0) + 1,
      state: "open",
      openedAt: serverNow(),
      buzz: null,
    };
    return next;
  });
  return (result.snapshot.val() as RoundData).number;
}

export type BuzzOutcome = { won: true; round: RoundData } | { won: false };

/**
 * THE race-critical call. Every buzzing client runs a transaction on the same
 * /game/round node; RTDB serializes them so exactly one commit wins.
 *
 * The transaction commits only if the round is still 'open' with no buzz.
 * The winner's playerId is bound to the committed round number atomically, so
 * a stale client cannot inject a buzz into a later round. `buzzedAt` uses the
 * SERVER clock — local timestamps never decide the winner.
 */
export async function attemptBuzz(
  code: RoomCode,
  playerId: string,
  displayName: string,
  videoTime: number,
): Promise<BuzzOutcome> {
  const db = getFirebaseDatabase();
  const result = await runTransaction(ref(db, roomRoundPath(code)), (round: RoundData | null) => {
    if (!round || round.state !== "open" || round.buzz) {
      return; // abort: someone already buzzed or round not open
    }
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
