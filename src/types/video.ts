import type { UserId } from "./common";

/**
 * Authoritative playback state at /rooms/{id}/video.
 * Written by the HOST only (enforced by security rules).
 *
 * Feedback-loop safety: `seq` increments on every change; clients ignore any
 * incoming state whose seq is not greater than the last one they applied, so
 * echoes and out-of-order snapshots never retrigger actions.
 */
export interface VideoState {
  /** YouTube video id selected by the host. */
  videoId: string;
  /** True while playback should be running for everyone. */
  playing: boolean;
  /** Position (seconds) at the moment this change was made. */
  currentTimeSec: number;
  /** Server timestamp (ms) of the change; elapsed playback derives from it. */
  changedAt: number;
  /** Uid of whoever made the change. */
  changedBy: UserId;
  /** Monotonic sequence number, unique per room. */
  seq: number;
}
