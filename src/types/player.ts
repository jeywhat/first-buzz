import type { UserId } from "./common";

export interface RoomMeta {
  /** Auth uid of the host. Immutable after room creation. */
  hostUid: UserId;
  /** Epoch ms (serverTimestamp at creation). */
  createdAt: number;
  /** Epoch ms (serverTimestamp); bumped on activity to support manual cleanup. */
  lastActivityAt: number;
  /** Whether the host may also buzz. Default false; host-writable via rules. */
  allowHostToBuzz: boolean;
}

export interface PlayerProfile {
  name: string;
  /** Hex color, picked from PLAYER_COLORS at join time. */
  color: string;
}

export interface PlayerRecord {
  profile: PlayerProfile;
  /** Epoch ms (serverTimestamp), written once by the player at join. */
  joinedAt: number;
  /** Host-controlled. */
  score: number;
}

/** Palette players pick from; deterministic per-uid assignment avoids collisions. */
export const PLAYER_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;
