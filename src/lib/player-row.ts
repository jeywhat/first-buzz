import type { ParticipantView, PresenceState } from "../types/participant";

/* ------------------------------------------------------------------ */
/*  Pure helpers for the Players panel rows                            */
/*  (kept DOM-free so they are unit-testable without a DOM env)        */
/* ------------------------------------------------------------------ */

/** Presence first (online > connecting/reconnecting > offline), then score. */
export const STATE_RANK: Record<PresenceState, number> = {
  online: 0,
  connecting: 1,
  reconnecting: 1,
  offline: 2,
};

export const STATE_LABELS: Record<PresenceState, string> = {
  online: "online",
  connecting: "connecting…",
  reconnecting: "reconnecting…",
  offline: "offline",
};

/**
 * Canonical scoreboard order — the documented current product rule:
 * presence, score descending, join order, then name.
 * Deterministic and stable: the same input list always sorts to the same
 * order, so a score update that does not change the ranking never moves rows.
 */
export function comparePlayers(a: ParticipantView, b: ParticipantView): number {
  const joinA = a.joinedAt ?? Number.MAX_SAFE_INTEGER;
  const joinB = b.joinedAt ?? Number.MAX_SAFE_INTEGER;
  return (
    STATE_RANK[a.presenceState] - STATE_RANK[b.presenceState] ||
    b.score - a.score ||
    joinA - joinB ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Toast / aria-live copy for a confirmed score adjustment.
 * "Added 1 point to Alice" / "Removed 1 point from Bob".
 */
export function formatScoreAdjustmentToast(delta: number, displayName: string): string {
  const n = Math.abs(delta);
  const points = n === 1 ? "1 point" : `${n} points`;
  return `${delta > 0 ? "Added" : "Removed"} ${points} ${delta > 0 ? "to" : "from"} ${displayName}`;
}
