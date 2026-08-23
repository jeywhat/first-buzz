import {
  onValue,
  ref,
  runTransaction,
  update,
  type Unsubscribe,
} from "firebase/database";
import type {
  ParticipantView,
  PlayerRecord,
  PresenceRecord,
  PresenceState,
  RoomCode,
  UserId,
} from "../types";
import { PLAYER_COLORS } from "../types";
import { getFirebaseDatabase } from "./firebase";
import { playerProfilePath, playersPath, roomPath } from "./paths";
import {
  subscribeToRoomPresence,
} from "../services/presenceService";
import { serverNow } from "./timestamp";

/** Fallback color when a participant has no durable profile yet. */
const NEUTRAL_COLOR = "#64748b";

/**
 * Joins the room: creates/overwrites the caller's own profile and sets
 * joinedAt once. Score is NOT written here (host-controlled); it stays absent
 * (= 0) until the host's first award.
 */
export async function joinRoom(
  code: RoomCode,
  uid: UserId,
  profile: { name: string; color: string },
): Promise<void> {
  const db = getFirebaseDatabase();
  await update(ref(db), {
    [playerProfilePath(code, uid)]: profile,
    [`rooms/${code}/players/${uid}/joinedAt`]: serverNow(),
  });
}

/** Deterministic color per uid so two players never need to negotiate. */
export function pickColor(uid: UserId): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  return PLAYER_COLORS[hash % PLAYER_COLORS.length] ?? PLAYER_COLORS[0];
}

/** Subscribes to the room's durable player records. Returns an unsubscribe fn. */
export function watchPlayers(
  code: RoomCode,
  onChange: (players: Record<UserId, PlayerRecord>) => void,
): Unsubscribe {
  const db = getFirebaseDatabase();
  return onValue(ref(db, playersPath(code)), (snap) => {
    onChange(snap.exists() ? snap.val() : {});
  });
}

export interface RoomParticipantsOptions {
  /** Auth uid of the local viewer (for the "reconnecting" self state). */
  selfUid: UserId;
  /** Live /.info/connected value of the LOCAL client. */
  isSelfConnected: () => boolean;
  /** Estimated server clock for the 60s staleness comparison. */
  getServerNow: () => number;
}

const PRESENCE_STALE_MS = 60_000;
const CONNECTING_GRACE_MS = 15_000;

// First time we saw a uid WITHOUT a presence record: grants the
// "Connecting…" grace window instead of an immediate "Offline".
const firstSeenWithoutPresence = new Map<UserId, number>();

function derivePresenceState(
  uid: UserId,
  presence: PresenceRecord | undefined,
  opts: RoomParticipantsOptions,
): PresenceState {
  const now = opts.getServerNow();

  // Self + local socket down: reconnecting, regardless of stored state.
  if (uid === opts.selfUid && !opts.isSelfConnected()) return "reconnecting";

  // No presence node yet: grace window ("Connecting…"), never instant-offline.
  if (!presence || presence.isOnline === undefined) {
    const first = firstSeenWithoutPresence.get(uid) ?? now;
    firstSeenWithoutPresence.set(uid, first);
    return now - first < CONNECTING_GRACE_MS ? "connecting" : "offline";
  }

  if (presence.isOnline !== true) return "offline";

  const lastSeen = presence.lastSeenAt;
  // Unresolved server timestamp must never mark a player offline by itself.
  if (typeof lastSeen !== "number") return "online";
  firstSeenWithoutPresence.delete(uid);
  return now - lastSeen > PRESENCE_STALE_MS ? "offline" : "online";
}

/**
 * Merges three live streams — durable player records, canonical /presence
 * records and meta.hostUid — into ParticipantView list entries, deriving the
 * UI presence state per the presence service rules.
 */
export function watchRoomParticipants(
  code: RoomCode,
  opts: RoomParticipantsOptions,
  onChange: (participants: ParticipantView[]) => void,
): Unsubscribe {
  const db = getFirebaseDatabase();
  let players: Record<UserId, PlayerRecord> = {};
  let presence: Record<UserId, PresenceRecord> = {};
  let hostUid: UserId | null = null;

  const emit = (): void => {
    const uids = new Set([...Object.keys(players), ...Object.keys(presence)]);
    const list: ParticipantView[] = Array.from(uids, (uid) => {
      const player = players[uid];
      const pres = presence[uid];
      return {
        uid,
        name: player?.profile.name ?? pres?.displayName ?? "Unknown",
        color: player?.profile.color ?? NEUTRAL_COLOR,
        score: player?.score ?? 0,
        presenceState: derivePresenceState(uid, pres, opts),
        isHost: hostUid !== null && uid === hostUid,
        joinedAt: player?.joinedAt,
      };
    });
    onChange(list);

    // Prune grace-window entries for uids that left both streams.
    for (const key of [...firstSeenWithoutPresence.keys()]) {
      if (!uids.has(key)) firstSeenWithoutPresence.delete(key);
    }
  };

  const unPlayers = watchPlayers(code, (p) => {
    players = p;
    emit();
  });
  const unPresence = subscribeToRoomPresence(code, (map) => {
    presence = map;
    emit();
  });
  const unHost = onValue(ref(db, `${roomPath(code)}/meta/hostUid`), (snap) => {
    hostUid = (snap.val() as UserId | null) ?? null;
    emit();
  });

  return () => {
    unPlayers();
    unPresence();
    unHost();
  };
}

/**
 * Host-only: atomically adds `delta` points to a player's score.
 * Transaction avoids lost updates if the host judges quickly twice.
 */
export async function adjustScore(
  code: RoomCode,
  uid: UserId,
  delta: number,
): Promise<number> {
  const scoreRef = ref(getFirebaseDatabase(), `rooms/${code}/players/${uid}/score`);
  const result = await runTransaction(scoreRef, (current) => (current ?? 0) + delta);
  return result.snapshot.val() as number;
}
