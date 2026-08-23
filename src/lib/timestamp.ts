import { increment, serverTimestamp } from "firebase/database";

/**
 * Placeholder that RTDB replaces with the server clock on write.
 * Cast to `number` so it type-checks against our timestamp fields;
 * locally (before ack) reads may briefly see an estimate or null.
 */
export function serverNow(): number {
  return serverTimestamp() as unknown as number;
}

/** Atomic increment placeholder for score updates. */
export function incrementBy(delta: number): number {
  return increment(delta) as unknown as number;
}
