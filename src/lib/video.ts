import { onValue, ref, runTransaction, type Unsubscribe } from "firebase/database";
import type { RoomCode, UserId, VideoState } from "../types";
import { getFirebaseDatabase } from "./firebase";
import { roomVideoPath } from "./paths";
import { serverNow } from "./timestamp";

/**
 * Host-only transactional write: `seq` is bumped inside the transaction so two
 * host tabs can never produce duplicate sequence numbers.
 */
function pushVideoChange(
  code: RoomCode,
  transform: (current: VideoState | null) => VideoState,
): Promise<void> {
  const db = getFirebaseDatabase();
  return runTransaction(ref(db, roomVideoPath(code)), (current) =>
    transform(current),
  ).then(() => undefined);
}

/** Host action: start playback from an explicit position. */
export function requestPlay(
  code: RoomCode,
  uid: UserId,
  positionSec: number,
): Promise<void> {
  return pushVideoChange(code, (cur) => ({
    videoId: cur?.videoId ?? "",
    playing: true,
    currentTimeSec: Math.max(0, positionSec),
    changedAt: serverNow(),
    changedBy: uid,
    seq: (cur?.seq ?? 0) + 1,
  }));
}

/** Host action: pause everyone at an explicit position. */
export function requestPause(
  code: RoomCode,
  uid: UserId,
  positionSec: number,
): Promise<void> {
  return pushVideoChange(code, (cur) => ({
    videoId: cur?.videoId ?? "",
    playing: false,
    currentTimeSec: Math.max(0, positionSec),
    changedAt: serverNow(),
    changedBy: uid,
    seq: (cur?.seq ?? 0) + 1,
  }));
}

/** Host action: seek; playback keeps running or paused as before. */
export function requestSeek(
  code: RoomCode,
  uid: UserId,
  positionSec: number,
): Promise<void> {
  return pushVideoChange(code, (cur) => ({
    videoId: cur?.videoId ?? "",
    playing: cur?.playing ?? false,
    currentTimeSec: Math.max(0, positionSec),
    changedAt: serverNow(),
    changedBy: uid,
    seq: (cur?.seq ?? 0) + 1,
  }));
}

/**
 * Host action: manual re-sync broadcast. Re-anchors position for EVERYONE
 * while preserving the current playing flag (unlike requestPlay/requestPause).
 */
export function requestResync(
  code: RoomCode,
  uid: UserId,
  positionSec: number,
): Promise<void> {
  return pushVideoChange(code, (cur) => ({
    videoId: cur?.videoId ?? "",
    playing: cur?.playing ?? false,
    currentTimeSec: Math.max(0, positionSec),
    changedAt: serverNow(),
    changedBy: uid,
    seq: (cur?.seq ?? 0) + 1,
  }));
}

/**
 * Host-only periodic re-anchor while playing (covers late joiners and drift).
 * Returns a stop function; callers start/stop it based on playing state.
 */
export function startPlaybackHeartbeat(
  code: RoomCode,
  uid: UserId,
  getPosition: () => number,
  intervalMs = 10_000,
): () => void {
  const timer = window.setInterval(() => {
    void requestPlay(code, uid, getPosition()).catch(() => undefined);
  }, intervalMs);
  return () => window.clearInterval(timer);
}

/** Subscribes to authoritative playback state. Returns an unsubscribe fn. */
export function watchVideoState(
  code: RoomCode,
  onChange: (state: VideoState) => void,
): Unsubscribe {
  const db = getFirebaseDatabase();
  return onValue(ref(db, roomVideoPath(code)), (snap) => {
    onChange(snap.val() as VideoState);
  });
}
