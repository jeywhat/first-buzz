import type { UserId } from "./common";

/** Live presence classification used by the participant UI. */
export type PresenceState = "online" | "reconnecting" | "connecting" | "offline";

/**
 * Merged view model for the participant list UI.
 * Durable game data comes from /rooms/{id}/players/{uid}; LIVE online status
 * comes from /presence/{roomId}/{uid} — the single canonical source for
 * presence (never a second boolean on the player record).
 */
export interface ParticipantView {
  uid: UserId;
  name: string;
  color: string;
  /** Absent score coalesces to 0. */
  score: number;
  presenceState: PresenceState;
  /** True when this participant is the room host. */
  isHost: boolean;
  /** Join order timestamp (server clock); absent for presence-only ghosts. */
  joinedAt?: number;
}

/**
 * Canonical LIVE presence node at /presence/{roomId}/{uid}.
 * Written by its owner only. `lastDisconnectedAt` is null while online.
 * Legacy `connected`/`joinedAt` fields from the previous schema are optional:
 * they are deleted on the next presence write (migration cleanup).
 */
export interface PresenceRecord {
  displayName: string;
  isOnline: boolean;
  connectedAt: number;
  lastSeenAt: number;
  lastDisconnectedAt?: number | null;
  sessionId: string;
  /** @deprecated legacy field, removed on next write */
  connected?: boolean;
  /** @deprecated legacy field, removed on next write */
  joinedAt?: number;
}
