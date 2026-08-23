import { onValue, ref, type Unsubscribe } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";

/** Subscribes to the local client's Realtime Database connection state. */
export function watchConnectionState(onChange: (online: boolean) => void): Unsubscribe {
  const connectedRef = ref(getFirebaseDatabase(), ".info/connected");
  return onValue(connectedRef, (snap) => onChange(snap.val() === true));
}

/**
 * Subscribes to the server-clock offset (ms to add to Date.now()).
 * Used to compute playback position elapsed since a server timestamp.
 */
export function watchServerTimeOffset(onChange: (offsetMs: number) => void): Unsubscribe {
  const offsetRef = ref(getFirebaseDatabase(), ".info/serverTimeOffset");
  return onValue(offsetRef, (snap) => onChange((snap.val() as number | null) ?? 0));
}
