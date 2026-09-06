export type GameStatus = "lobby" | "active" | "ended";

/**
 * Round lifecycle (post buzz/score decoupling):
 *  idle      -> resting state; no round is running (buzzes impossible)
 *  open      -> players may buzz (transaction decides the single winner);
 *               host may pause/resume playback freely
 *  buzzed    -> first winner saved by the RTDB transaction; video globally
 *               paused; no score mutation; host sees resume/next-buzz controls
 *  cooldown  -> host activated "Resume & open buzz": winner cleared,
 *               roundNumber incremented, playback resumed, brief global
 *               fairness window before anyone may buzz again
 *  open      -> cooldown expired (or host opened the next round): buzzing
 *               re-armed for everyone
 *
 * Typical loop: open → buzzed → (host resume) cooldown → open …
 * A room starts with round.state = 'idle' so nobody can buzz in the lobby.
 */
export type RoundState = "idle" | "open" | "buzzed" | "cooldown" | "resolved" | "finished";

export const ROUND_STATES: readonly RoundState[] = [
  "idle",
  "open",
  "buzzed",
  "cooldown",
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
  /**
   * Server-timestamp ms of the resume instant while state === 'cooldown'.
   * RTDB server timestamps cannot be offset at write time, so the duration
   * is the shared RESUME_BUZZ_COOLDOWN_MS constant compared against the
   * client's server-clock estimate. null clears the field on expiry.
   */
  cooldownStartedAt?: number | null;
  /** Playback-session fingerprint this round belongs to (staleness guard). */
  videoSessionId?: number;
  /** Present only once someone has buzzed. */
  buzz?: Buzz | null;
  /** @deprecated legacy buzz-scoring field — read-only; never written by new flows. */
  result?: RoundResult | null;
  /** @deprecated legacy buzz-scoring field — read-only; never written by new flows. */
  pointsAwarded?: number;
}

export interface GameData {
  status: GameStatus;
  round: RoundData;
}
