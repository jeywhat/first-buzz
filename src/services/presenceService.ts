import {
  onDisconnect,
  onValue,
  ref,
  update,
  type Unsubscribe,
} from "firebase/database";
import type { RoomCode, UserId } from "../types";
import type { PresenceRecord } from "../types/participant";
import { ensureAnonymousSignIn, getFirebaseDatabase } from "../lib/firebase";
import { presenceRoomPath, presenceUserPath } from "../lib/paths";
import { serverNow } from "../lib/timestamp";

export interface PresenceUser {
  uid: UserId;
  displayName: string;
}

const HEARTBEAT_INTERVAL_MS = 20_000;

/** One session id per page load — distinguishes tabs/devices of the same user. */
const sessionId: string = crypto.randomUUID();

let active = false;
let activeRoom: RoomCode | null = null;
let activeUid: UserId | null = null;
let activeDisplayNameValue = "";
let unsubscribeConnected: Unsubscribe | null = null;
let unsubscribeOffset: Unsubscribe | null = null;
let heartbeatTimer: number | null = null;
let serverTimeOffsetMs = 0;
let connectedFlag = false;
let lastWriteError: string | null = null;

function logDev(...args: unknown[]): void {
  if (import.meta.env.DEV) console.debug("[presence]", ...args);
}

function warnWriteError(stage: string, err: unknown): void {
  lastWriteError = (err as { code?: string })?.code ?? String(err);
  if (import.meta.env.DEV) {
    console.warn(`[presence] ${stage} rejected:`, lastWriteError, err);
  }
}

/** Estimated server clock (Date.now() + /.info/serverTimeOffset). UI-only. */
export function getEstimatedServerNow(): number {
  return Date.now() + serverTimeOffsetMs;
}

function ensureOffsetListener(): void {
  if (unsubscribeOffset) return;
  unsubscribeOffset = onValue(
    ref(getFirebaseDatabase(), ".info/serverTimeOffset"),
    (snap) => {
      serverTimeOffsetMs = (snap.val() as number | null) ?? 0;
    },
  );
}

function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    logDev("heartbeat stopped");
  }
}

function startHeartbeat(roomId: RoomCode, uid: UserId): void {
  // Single-interval guard: never two heartbeats for the same session.
  if (heartbeatTimer !== null) return;
  heartbeatTimer = window.setInterval(() => {
    if (!connectedFlag) return; // heartbeat only while Firebase says connected
    void update(ref(getFirebaseDatabase(), presenceUserPath(roomId, uid)), {
      lastSeenAt: serverNow(),
    }).catch((err) => warnWriteError("heartbeat", err));
  }, HEARTBEAT_INTERVAL_MS);
  logDev(`heartbeat started (${HEARTBEAT_INTERVAL_MS}ms)`);
}

/**
 * Connection sequence (in order):
 *  1. arm onDisconnect() FIRST — sets isOnline:false + server timestamps;
 *  2. only after Firebase acknowledges it, write the online presence.
 * `connected: null` deletes the legacy field from the previous schema.
 */
async function writeOnline(
  roomId: RoomCode,
  uid: UserId,
  displayName: string,
): Promise<void> {
  const presenceRef = ref(getFirebaseDatabase(), presenceUserPath(roomId, uid));
  await onDisconnect(presenceRef).update({
    isOnline: false,
    lastSeenAt: serverNow(),
    lastDisconnectedAt: serverNow(),
    connected: null,
  });
  await update(presenceRef, {
    displayName,
    isOnline: true,
    connectedAt: serverNow(),
    lastSeenAt: serverNow(),
    sessionId,
    connected: null,
  });
  lastWriteError = null;
  logDev("presence online write acknowledged");
}

/** DEV-only diagnostics snapshot. */
export function getPresenceDebugInfo(): {
  uid: string | null;
  sessionId: string;
  connected: boolean;
  serverTimeOffsetMs: number;
  presencePath: string | null;
  lastWriteError: string | null;
} {
  return {
    uid: activeUid ?? null,
    sessionId,
    connected: connectedFlag,
    serverTimeOffsetMs,
    presencePath:
      activeRoom && activeUid ? presenceUserPath(activeRoom, activeUid) : null,
    lastWriteError,
  };
}

/** DEV-only: re-run the online write + heartbeat immediately. */
export async function forcePresenceRefresh(): Promise<void> {
  if (!activeRoom || !activeUid) return;
  await writeOnline(activeRoom, activeUid, activeDisplayNameValue);
  startHeartbeat(activeRoom, activeUid);
}

/**
 * Starts presence for the current page session:
 * auth -> /.info/connected listener -> onDisconnect-first -> online write ->
 * 20s lastSeenAt heartbeat. Idempotent per room+user; stops any prior session.
 */
export async function startPresence(
  roomId: RoomCode,
  user: PresenceUser,
): Promise<void> {
  ensureOffsetListener();
  if (active && activeRoom === roomId && activeUid === user.uid) return;
  if (active) await stopPresence();

  // Requirement: Anonymous Auth MUST be resolved before any presence write.
  const uid = await ensureAnonymousSignIn();

  active = true;
  activeRoom = roomId;
  activeUid = uid;
  activeDisplayNameValue = user.displayName;
  lastWriteError = null;

  unsubscribeConnected = onValue(ref(getFirebaseDatabase(), ".info/connected"), (snap) => {
    connectedFlag = snap.val() === true;
    logDev(`.info/connected = ${connectedFlag}`);

    if (!connectedFlag) {
      // Do NOT trust a client write here: let the server run the registered
      // onDisconnect() operation, and stop the heartbeat.
      stopHeartbeat();
      return;
    }

    void (async () => {
      try {
        await writeOnline(roomId, uid, user.displayName);
        startHeartbeat(roomId, uid);
      } catch (err) {
        warnWriteError("connect sequence", err);
      }
    })();
  });
}

/**
 * Clean leave: final offline write, then cancels the registered
 * onDisconnect(), then tears down every listener and timer.
 */
export async function stopPresence(): Promise<void> {
  stopHeartbeat();
  if (unsubscribeConnected) {
    unsubscribeConnected();
    unsubscribeConnected = null;
  }

  const room = activeRoom;
  const uid = activeUid;
  active = false;
  activeRoom = null;
  activeUid = null;

  if (!room || !uid) return;

  const presenceRef = ref(getFirebaseDatabase(), presenceUserPath(room, uid));
  try {
    await update(presenceRef, {
      isOnline: false,
      lastSeenAt: serverNow(),
      lastDisconnectedAt: serverNow(),
      connected: null,
    });
    await onDisconnect(presenceRef).cancel();
    logDev("presence stopped cleanly");
  } catch (err) {
    warnWriteError("presence stop", err);
  }
}

/** Live subscription to every presence record in a room. */
export function subscribeToRoomPresence(
  roomId: RoomCode,
  callback: (presence: Record<UserId, PresenceRecord>) => void,
): Unsubscribe {
  return onValue(ref(getFirebaseDatabase(), presenceRoomPath(roomId)), (snap) => {
    callback((snap.val() ?? {}) as Record<UserId, PresenceRecord>);
  });
}
