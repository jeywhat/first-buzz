import { get, ref, remove, set, update } from "firebase/database";
import type { GameStatus, RoomCode, RoomData, UserId } from "../types";
import { getFirebaseDatabase } from "./firebase";
import { roomGamePath, roomMetaPath, roomPath } from "./paths";
import { serverNow } from "./timestamp";
import { VIDEO_ID_PATTERN } from "./youtube";

/** Room code alphabet: uppercase digits/letters without 0/O/1/I (unambiguous when read aloud). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
const MAX_CREATE_ATTEMPTS = 5;

/** Cryptographically random room code, e.g. "K7T2QM". */
export function generateRoomCode(): RoomCode {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/**
 * Creates a room owned by `hostUid`.
 * `videoId` may be EMPTY — the host picks a video later from the queue.
 * Retries with a fresh code on the (unlikely) collision of an existing code.
 * Throws only when a NON-EMPTY videoId is not a valid YouTube id.
 */
export async function createRoom(hostUid: UserId, videoId = ""): Promise<RoomCode> {
  if (videoId && !VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error("Invalid YouTube video id.");
  }
  const db = getFirebaseDatabase();

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const existing = await get(ref(db, roomMetaPath(code)));
    if (existing.exists()) continue;

    const now = serverNow();
    // Single atomic room write: the security rules allow room creation only at
    // the room root and only when meta.hostUid equals the creator's uid.
    // videoId === '' encodes the idle "no video yet" state (rules-validated).
    await set(ref(db, roomPath(code)), {
      meta: { hostUid, createdAt: now, lastActivityAt: now, allowHostToBuzz: true },
      video: {
        videoId,
        playing: false,
        currentTimeSec: 0,
        changedAt: now,
        changedBy: hostUid,
        seq: 0,
        activeQueueItemId: null,
        videoSessionId: 0,
      },
      game: {
        status: "lobby",
        round: { number: 0, state: "idle", result: null, pointsAwarded: 0 },
      },
    });
    return code;
  }
  throw new Error("Could not generate a free room code — try again.");
}

const ROOM_CODE_RE = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LENGTH}}$`, "i");

/**
 * Accepts a bare code ("K7T2QM"), a share link (/room/K7T2QM) or an old
 * query link (?room=K7T2QM). Scheme-less links get https:// prepended so a
 * pasted "localhost:5173/room/X" also works. Returns uppercase code or null.
 */
export function parseRoomCode(input: string): RoomCode | null {
  const value = input.trim();
  if (!value) return null;
  if (ROOM_CODE_RE.test(value)) return value.toUpperCase();

  let candidate = value;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;

  try {
    const url = new URL(candidate);
    const fromPath = /^\/room\/([A-Za-z0-9]{6})\/?$/.exec(url.pathname)?.[1];
    const fromQuery = url.searchParams.get("room");
    const found = fromPath ?? fromQuery ?? "";
    return ROOM_CODE_RE.test(found) ? found.toUpperCase() : null;
  } catch {
    return null;
  }
}

/** Fetches the full room once (members only per rules). Returns null if absent. */
export async function fetchRoom(code: RoomCode): Promise<RoomData | null> {
  const snapshot = await get(ref(getFirebaseDatabase(), roomPath(code)));
  return snapshot.exists() ? (snapshot.val() as RoomData) : null;
}

/**
 * Narrow pre-join probe permitted by rules for ANY authenticated user:
 * null = no such room; otherwise the game status. Full room data is
 * member-gated and must be fetched only after joining.
 */
export async function fetchRoomStatus(
  code: RoomCode,
): Promise<GameStatus | null> {
  const snap = await get(ref(getFirebaseDatabase(), `${roomGamePath(code)}/status`));
  return (snap.val() as GameStatus | null) ?? null;
}

/** Host-only room deletion — rules allow removing the entire node. */
export async function deleteRoom(code: RoomCode): Promise<void> {
  await remove(ref(getFirebaseDatabase(), roomPath(code)));
}

/** Bumps lastActivityAt (server clock) for future manual cleanup sweeps. */
export async function touchRoomActivity(code: RoomCode): Promise<void> {
  await update(ref(getFirebaseDatabase(), roomMetaPath(code)), {
    lastActivityAt: serverNow(),
  });
}

/**
 * Host-only: toggles whether the host may also buzz. Rules restrict the write
 * to the room host and validate the value as a boolean. The buzzer's enabled
 * state is derived from this flag via evaluateBuzz().
 */
export async function setAllowHostToBuzz(code: RoomCode, allow: boolean): Promise<void> {
  await update(ref(getFirebaseDatabase(), roomMetaPath(code)), {
    allowHostToBuzz: allow,
  });
}
