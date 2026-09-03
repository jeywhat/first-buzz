import type { ParticipantView, PresenceState } from "../types/participant";
import type { RoundData } from "../types/round";
import type { UserId } from "../types/common";

/**
 * View model for a single podium in the circular Player Arena.
 * All fields are derived from existing room/presence/round data — no new
 * Firebase writes. `avatarSeed` is the stable userId so the avatar is
 * deterministic across refreshes and clients.
 */
export interface StagePlayer {
  uid: UserId;
  name: string;
  color: string;
  score: number;
  presenceState: PresenceState;
  isHost: boolean;
  isCurrentUser: boolean;
  /** True when this player holds the current round's buzz (buzzed first). */
  isWinner: boolean;
  joinedAt?: number;
  avatarSeed: string;
  /** Sort tier: 0 winner, 1 you, 2 online, 3 connecting/reconnecting, 4 offline. */
  sortTier: number;
}

export interface ArenaViewModel {
  /** Up to MAX players rendered on the orbit ring, in stable order. */
  visible: StagePlayer[];
  /** How many additional players are summarized as "+N". */
  overflowCount: number;
  total: number;
  onlineCount: number;
  /** True only while RTDB round is authoritatively "buzzed" with a winner. */
  roundLocked: boolean;
}

export const MAX_ARENA_PLAYERS = 8;

/**
 * Stable arena ordering: 1) current buzz winner, 2) current user,
 * 3) online players, 4) connecting/reconnecting, 5) offline, then join order
 * and name. Score is intentionally NOT part of the sort — a score change must
 * never reshuffle the arena (spec: stable positions during ordinary updates).
 */
export function getArenaPlayers(
  players: ParticipantView[],
  round: RoundData | null,
  currentUserId: UserId,
): ArenaViewModel {
  const winnerId = round?.buzz?.playerId ?? null;
  const roundHasBuzz = round?.state === "buzzed" || round?.state === "resolved";

  const enriched: StagePlayer[] = players.map((p) => {
    const isWinner = roundHasBuzz && p.uid === winnerId;
    const isCurrentUser = p.uid === currentUserId;
    return {
      uid: p.uid,
      name: p.name,
      color: p.color,
      score: p.score,
      presenceState: p.presenceState,
      isHost: p.isHost,
      isCurrentUser,
      isWinner,
      joinedAt: p.joinedAt,
      avatarSeed: p.uid,
      sortTier: tierFor(p, isWinner, isCurrentUser),
    };
  });

  enriched.sort(
    (a, b) =>
      a.sortTier - b.sortTier ||
      (a.joinedAt ?? Number.MAX_SAFE_INTEGER) - (b.joinedAt ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  );

  const onlineCount = players.filter((p) => p.presenceState === "online").length;
  const total = enriched.length;

  if (total <= MAX_ARENA_PLAYERS) {
    return { visible: enriched, overflowCount: 0, total, onlineCount, roundLocked: roundHasBuzz && !!winnerId };
  }
  return {
    visible: enriched.slice(0, MAX_ARENA_PLAYERS),
    overflowCount: total - MAX_ARENA_PLAYERS,
    total,
    onlineCount,
    roundLocked: roundHasBuzz && !!winnerId,
  };
}

function tierFor(
  p: ParticipantView,
  isWinner: boolean,
  isCurrentUser: boolean,
): number {
  if (isWinner) return 0;
  if (isCurrentUser) return 1;
  if (p.presenceState === "online") return 2;
  if (p.presenceState === "connecting" || p.presenceState === "reconnecting") return 3;
  return 4; // offline
}

/** Human-readable presence label (mirrors participant-list wording). */
export function presenceLabel(state: PresenceState): string {
  switch (state) {
    case "online":
      return "online";
    case "connecting":
      return "connecting";
    case "reconnecting":
      return "reconnecting";
    default:
      return "offline";
  }
}
