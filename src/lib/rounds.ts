import { get, onValue, ref, runTransaction, update, type Unsubscribe } from "firebase/database";
import type { RoomCode, RoundData, RoundResult } from "../types";
import { getFirebaseDatabase } from "./firebase";
import { roomGamePath, roomRoundPath } from "./paths";
import { incrementBy, serverNow } from "./timestamp";

/**
 * Host-only: closes any current round and opens the next one.
 * round.number is incremented so buzzes/points from old rounds can never be
 * reused against the new one.
 */
export async function openNextRound(code: RoomCode): Promise<number> {
  const db = getFirebaseDatabase();
  const result = await runTransaction(ref(db, roomRoundPath(code)), (round: RoundData | null) => {
    const next: RoundData = {
      number: (round?.number ?? 0) + 1,
      state: "open",
      openedAt: serverNow(),
      buzz: null,
      result: null,
      pointsAwarded: 0,
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

/**
 * Host-only: judges the current buzz. Awards points to the winner and moves
 * the round to 'validated' in one atomic multi-path update.
 */
export async function judgeBuzz(
  code: RoomCode,
  decision: { result: RoundResult; points: number },
): Promise<void> {
  const db = getFirebaseDatabase();
  const roundSnap = await getRoundSnapshot(code);
  const winnerId = roundSnap.buzz?.playerId;

  const updates: Record<string, unknown> = {
    [`${roomRoundPath(code)}/state`]: "resolved",
    [`${roomRoundPath(code)}/result`]: decision.result,
    [`${roomRoundPath(code)}/pointsAwarded`]: decision.points,
  };
  // Server-side atomic increment; score node itself stays host-writable only.
  if (decision.result === "correct" && winnerId && decision.points !== 0) {
    updates[`rooms/${code}/players/${winnerId}/score`] = incrementBy(decision.points);
  }
  await update(ref(db), updates);
}

/** Host-only: closes the round without judging (e.g. nobody answers). */
export async function finishRound(code: RoomCode): Promise<void> {
  await update(ref(getFirebaseDatabase(), roomRoundPath(code)), { state: "finished" });
}

/** Host-only: lobby -> active -> ended. */
export async function setGameStatus(
  code: RoomCode,
  status: "lobby" | "active" | "ended",
): Promise<void> {
  await update(ref(getFirebaseDatabase(), roomGamePath(code)), { status });
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

async function getRoundSnapshot(code: RoomCode): Promise<RoundData> {
  const snap = await get(ref(getFirebaseDatabase(), roomRoundPath(code)));
  return (snap.val() ?? { number: 0, state: "finished" }) as RoundData;
}
