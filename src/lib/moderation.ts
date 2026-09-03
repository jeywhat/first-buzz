import { ref, update } from "firebase/database";
import type { RoomCode } from "../types";
import { getFirebaseDatabase } from "./firebase";

/**
 * Host moderation helpers (post-buzz-decoupling migration).
 *
 * Buzz results no longer drive scores or playback: the host panel controls
 * "Resume video" / "Open next buzz" call requestPlay()/openNextRound()
 * directly. Only manual score management remains here; every touched
 * subtree is host-writable per database.rules.json.
 */

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
