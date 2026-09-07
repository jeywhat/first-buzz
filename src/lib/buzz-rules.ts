import type { Buzz, RoundState } from "../types";

export interface BuzzContext {
  /** Auth uid of the local viewer. */
  playerId: string;
  viewerIsHost: boolean;
  allowHostToBuzz: boolean;
  /** True while this viewer's own transaction is in flight. */
  hasPendingAttempt: boolean;
}

export type BuzzBlockReason =
  | "pending"
  | "won"
  | "taken"
  | "waiting"
  | "cooldown"
  | "round_over"
  | "host_forbidden";

/* ------------------------------------------------------------------ */
/*  Post-buzz resume delay (host lockout)                              */
/* ------------------------------------------------------------------ */

/**
 * How long the host's "Resume & open buzz" action stays locked after a buzz
 * lands (round.state === 'buzzed'). Gives the room a beat to see WHO buzzed
 * before the host can wipe the popup and restart playback.
 */
export const RESUME_DELAY_MS = 1000;

/**
 * Pure gate deciding whether the host resume action has unlocked after a
 * buzz. Same server-anchored pattern as isCooldownExpired: the buzz stores
 * the SERVER time (`buzz.buzzedAt`) and the client compares its ESTIMATED
 * server clock — local clocks never decide anything.
 *
 * Fail-open on a missing/invalid anchor: a buzzed round without a readable
 * `buzzedAt` must never permanently lock the host out of resuming.
 */
export function isResumeDelayExpired(
  buzzedAt: number | null | undefined,
  estimatedServerNow: number,
  delayMs: number = RESUME_DELAY_MS,
): boolean {
  if (typeof buzzedAt !== "number" || !Number.isFinite(buzzedAt)) {
    return true; // no anchor -> never lock the host out
  }
  return estimatedServerNow >= buzzedAt + delayMs;
}

/* ------------------------------------------------------------------ */
/*  Global fairness cooldown                                           */
/* ------------------------------------------------------------------ */

/** Default post-resume fairness window before anyone may buzz again. */
export const RESUME_BUZZ_COOLDOWN_MS = 350;
export const MIN_RESUME_BUZZ_COOLDOWN_MS = 0;
export const MAX_RESUME_BUZZ_COOLDOWN_MS = 1000;

/** Clamps a configured cooldown into the allowed 0..1000ms range. */
export function clampResumeBuzzCooldownMs(ms: number): number {
  if (!Number.isFinite(ms)) return RESUME_BUZZ_COOLDOWN_MS;
  return Math.min(MAX_RESUME_BUZZ_COOLDOWN_MS, Math.max(MIN_RESUME_BUZZ_COOLDOWN_MS, ms));
}

/**
 * Pure eligibility check for a round in `cooldown`.
 *
 * HONEST RTDB LIMITATION: server timestamps cannot be offset at write time
 * (no `serverTimestamp() + 350`), so the round persists the SERVER time of
 * the resume instant (`cooldownStartedAt`) and the shared constant supplies
 * the duration. `estimatedServerNow` is a CLIENT estimate of server time
 * (Date.now() + /.info/serverTimeOffset) used ONLY as an eligibility gate:
 * winner ordering is still decided exclusively by RTDB transaction
 * serialization + server timestamps, never by client clocks.
 */
export function isCooldownExpired(
  cooldownStartedAt: number | null | undefined,
  estimatedServerNow: number,
  cooldownMs: number = RESUME_BUZZ_COOLDOWN_MS,
): boolean {
  if (typeof cooldownStartedAt !== "number" || !Number.isFinite(cooldownStartedAt)) {
    return false; // no server anchor -> never treat cooldown as expired
  }
  return estimatedServerNow >= cooldownStartedAt + clampResumeBuzzCooldownMs(cooldownMs);
}

/** Minimal structural slice of RoundData needed for the decision. */
export interface BuzzRoundSlice {
  state: RoundState;
  buzz?: Buzz | null;
}

/**
 * Pure gate deciding whether THIS viewer may buzz right now, and why not.
 * The runtime enforcement still lives in the RTDB transaction + rules; this
 * only drives the UI so it always agrees with what the rules will decide.
 */
export function evaluateBuzz(
  round: BuzzRoundSlice,
  ctx: BuzzContext,
): { enabled: boolean; reason: BuzzBlockReason | null } {
  // An attempt in flight always wins the UI: prevents double-clicks.
  if (ctx.hasPendingAttempt) return { enabled: false, reason: "pending" };

  if (round.state === "open") {
    // A buzz during 'open' is transitional (about to flip to 'buzzed').
    if (round.buzz) return { enabled: false, reason: "taken" };
    if (ctx.viewerIsHost && !ctx.allowHostToBuzz) {
      return { enabled: false, reason: "host_forbidden" };
    }
    return { enabled: true, reason: null };
  }

  if (round.state === "buzzed") {
    const iWon = round.buzz?.playerId === ctx.playerId;
    return iWon ? { enabled: false, reason: "won" } : { enabled: false, reason: "taken" };
  }

  if (round.state === "cooldown") {
    // Global fairness window after the host resumed + opened the next buzz:
    // nobody (host included) may buzz until the cooldown expires.
    return { enabled: false, reason: "cooldown" };
  }

  if (round.state === "idle") return { enabled: false, reason: "waiting" };

  // validated | finished
  return { enabled: false, reason: "round_over" };
}
