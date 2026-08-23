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
  | "round_over"
  | "host_forbidden";

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

  if (round.state === "idle") return { enabled: false, reason: "waiting" };

  // validated | finished
  return { enabled: false, reason: "round_over" };
}
