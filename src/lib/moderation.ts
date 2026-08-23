import { ref, update } from "firebase/database";
import type { RoomCode, UserId } from "../types";
import { getFirebaseDatabase } from "./firebase";
import { judgeBuzz, openNextRound } from "./rounds";
import { requestPlay } from "./video";

/**
 * Host moderation flows. The sequencing is deliberate:
 *  1. judgeBuzz     — ONE atomic multi-path write: round → 'resolved' with
 *                     result/pointsAwarded, plus winner score increment.
 *  2. requestPlay   — resume everyone's video (fresh /video seq).
 *  3. openNextRound — transaction: roundNumber + 1, state back to 'open'.
 *
 * Every touched subtree is already host-writable per database.rules.json.
 */
export async function moderateCorrect(
  code: RoomCode,
  hostUid: UserId,
  resumePositionSec: number,
): Promise<void> {
  await judgeBuzz(code, { result: "correct", points: 1 });
  await requestPlay(code, hostUid, resumePositionSec);
  await openNextRound(code);
}

/** Wrong answer: identical flow minus any score change. */
export async function moderateWrong(
  code: RoomCode,
  hostUid: UserId,
  resumePositionSec: number,
): Promise<void> {
  await judgeBuzz(code, { result: "wrong", points: 0 });
  await requestPlay(code, hostUid, resumePositionSec);
  await openNextRound(code);
}

/**
 * Cancel: void the buzz entirely — reopen the round WITHOUT scoring it and
 * WITHOUT retroactively awarding it to anyone else.
 */
export async function moderateCancel(code: RoomCode): Promise<void> {
  await openNextRound(code);
}

/** Reset every given player's score to 0 in a single atomic multi-path write. */
export async function resetScores(
  code: RoomCode,
  playerIds: readonly string[],
): Promise<void> {
  if (playerIds.length === 0) return;
  const updates: Record<string, unknown> = {};
  for (const playerId of playerIds) {
    updates[`rooms/${code}/players/${playerId}/score`] = 0;
  }
  await update(ref(getFirebaseDatabase()), updates);
}
