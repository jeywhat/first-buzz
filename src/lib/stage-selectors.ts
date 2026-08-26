import type { ParticipantView, PresenceState } from "../types/participant";
import type { RoundData } from "../types/round";
import type { UserId } from "../types/common";

/**
 * View model for a single podium on the Buzzer Stage.
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

export interface StageViewModel {
  /** Up to 8 podiums to render prominently. */
  visible: StagePlayer[];
  /** How many additional players are hidden behind the "+N" card. */
  overflowCount: number;
  total: number;
}

export const MAX_PROMINENT_PODIUMS = 8;

/**
 * Pure selector: turns the merged participant list + current round into the
 * ordered set of stage podiums.
 *
 * Sort priority (stable): 1) current buzz winner, 2) current user,
 * 3) online players, 4) higher score, 5) room join order. Offline players
 * always rank after online ones. At most 8 podiums are shown; when more exist,
 * the first 7 by priority are kept and an eighth "+N" card summarizes the rest.
 */
export function getStagePlayers(
  players: ParticipantView[],
  round: RoundData | null,
  currentUserId: UserId,
): StageViewModel {
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

  enriched.sort(compareStage);

  const total = enriched.length;
  if (total <= MAX_PROMINENT_PODIUMS) {
    return { visible: enriched, overflowCount: 0, total };
  }

  // First 7 by priority + an eighth "+N" summary card.
  const visible = enriched.slice(0, MAX_PROMINENT_PODIUMS - 1);
  return {
    visible,
    overflowCount: total - (MAX_PROMINENT_PODIUMS - 1),
    total,
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

function compareStage(a: StagePlayer, b: StagePlayer): number {
  return (
    a.sortTier - b.sortTier ||
    b.score - a.score ||
    (a.joinedAt ?? Number.MAX_SAFE_INTEGER) - (b.joinedAt ?? Number.MAX_SAFE_INTEGER) ||
    a.name.localeCompare(b.name)
  );
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
