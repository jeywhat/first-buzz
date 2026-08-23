export type GameStatus = "lobby" | "active" | "ended";

/**
 * Round lifecycle:
 *  idle      -> resting state; no round is running (buzzes impossible)
 *  open      -> players may buzz (transaction decides the single winner)
 *  buzzed    -> a buzz exists, host is listening to the verbal answer
 *  resolved  -> host judged the answer (result + pointsAwarded set)
 *  finished  -> room closed; nothing can buzz anymore
 *
 * Typical loop driven by host moderation: idle → open → buzzed → resolved → open …
 * A room starts with round.state = 'idle' so nobody can buzz in the lobby.
 */
export type RoundState = "idle" | "open" | "buzzed" | "resolved" | "finished";

export const ROUND_STATES: readonly RoundState[] = [
  "idle",
  "open",
  "buzzed",
  "resolved",
  "finished",
];

export function isRoundState(value: unknown): value is RoundState {
  return typeof value === "string" && ROUND_STATES.includes(value as RoundState);
}

export type RoundResult = "correct" | "wrong";

export interface Buzz {
  /** Winner's auth uid — authoritative identity. */
  playerId: string;
  /** Display name copied at buzz time for cheap rendering. */
  displayName: string;
  /** Epoch ms (serverTimestamp) — THE authoritative buzz order. Never trust local clocks. */
  buzzedAt: number;
  /** Video position (seconds) captured locally via player.getCurrentTime(). */
  videoTime: number;
  /** Copy of round.number, binding this buzz to its round. */
  roundNumber: number;
}

export interface RoundData {
  number: number;
  state: RoundState;
  /** Epoch ms (serverTimestamp) when the host opened the round. */
  openedAt?: number;
  /** Present only once someone has buzzed. */
  buzz?: Buzz | null;
  result?: RoundResult | null;
  pointsAwarded?: number;
}

export interface GameData {
  status: GameStatus;
  round: RoundData;
}
