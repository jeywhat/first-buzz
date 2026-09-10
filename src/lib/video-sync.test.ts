import { describe, expect, it } from "vitest";
import type { VideoState } from "../types";
import {
  computeExpectedPositionSec,
  getDriftToleranceSec,
  isStaleSequence,
  planPausedAnchor,
  shouldSeekTo,
} from "./video-sync";

function state(overrides: Partial<VideoState> = {}): VideoState {
  return {
    videoId: "dQw4w9WgXcQ",
    playing: true,
    currentTimeSec: 100,
    changedAt: 1_000_000,
    changedBy: "host",
    seq: 7,
    ...overrides,
  };
}

const TOLERANCE = 0.75;

describe("getDriftToleranceSec", () => {
  it("exposes a positive tolerance even without env configuration", () => {
    expect(getDriftToleranceSec()).toBeGreaterThan(0);
  });
});

describe("computeExpectedPositionSec", () => {
  it("keeps paused playback frozen at the stored position", () => {
    const s = state({ playing: false, currentTimeSec: 42 });
    expect(computeExpectedPositionSec(s, s.changedAt + 999_999)).toBe(42);
  });

  it("adds elapsed server time while playing", () => {
    const s = state({ playing: true, currentTimeSec: 100 });
    // 30 seconds after the change → expected 130.
    expect(computeExpectedPositionSec(s, s.changedAt + 30_000)).toBeCloseTo(130);
  });

  it("never moves time backwards on writer/reader clock skew", () => {
    const s = state({ playing: true, currentTimeSec: 100 });
    expect(computeExpectedPositionSec(s, s.changedAt - 5_000)).toBe(100);
  });

  it("returns exactly the stored position at the instant of the change", () => {
    const s = state({ playing: true, currentTimeSec: 100 });
    expect(computeExpectedPositionSec(s, s.changedAt)).toBe(100);
  });
});

describe("isStaleSequence", () => {
  it("treats equal or older sequences as stale", () => {
    expect(isStaleSequence(7, 7)).toBe(true);
    expect(isStaleSequence(6, 7)).toBe(true);
  });

  it("accepts strictly newer sequences", () => {
    expect(isStaleSequence(8, 7)).toBe(false);
    expect(isStaleSequence(0, 0)).toBe(true);
  });
});

describe("shouldSeekTo", () => {
  it("ignores drift within tolerance", () => {
    expect(shouldSeekTo(100, 100 + TOLERANCE - 0.01, TOLERANCE)).toBe(false);
  });

  it("seeks beyond tolerance", () => {
    expect(shouldSeekTo(100, 100 + TOLERANCE + 0.01, TOLERANCE)).toBe(true);
  });

  it("uses a strict boundary at exactly the tolerance", () => {
    expect(shouldSeekTo(100, 100 + TOLERANCE, TOLERANCE)).toBe(false);
  });

  it("falls back to the configured default when no tolerance is passed", () => {
    const t = getDriftToleranceSec();
    expect(shouldSeekTo(100, 100 + t - 0.01)).toBe(false);
    expect(shouldSeekTo(100, 100 + t + 0.01)).toBe(true);
  });
});

describe("planPausedAnchor", () => {
  const PLAYING = 1;
  const PAUSED = 2;
  const BUFFERING = 3;
  const ENDED = 0;
  const CUED = 5;
  const UNSTARTED = -1;

  it("pauses in place when the player is currently playing", () => {
    expect(planPausedAnchor(PLAYING, 90, 42)).toEqual({ kind: "pause-in-place" });
  });

  it("pauses in place while buffering", () => {
    expect(planPausedAnchor(BUFFERING, 12, 42)).toEqual({ kind: "pause-in-place" });
  });

  it("does nothing when already at the target", () => {
    expect(planPausedAnchor(PAUSED, 42, 42)).toEqual({ kind: "none" });
  });

  it("seeks only from a genuinely paused player (never starts playback)", () => {
    expect(planPausedAnchor(PAUSED, 10, 42)).toEqual({ kind: "seek", positionSec: 42 });
  });

  it("re-cues instead of seeking from CUED (late-join autoplay regression)", () => {
    // The reported bug: a freshly-created joiner player is CUED; seekTo()
    // from CUED starts the video even though the room is paused.
    expect(planPausedAnchor(CUED, 0, 42)).toEqual({ kind: "cue", positionSec: 42 });
  });

  it("re-cues from UNSTARTED and ENDED", () => {
    expect(planPausedAnchor(UNSTARTED, 0, 42)).toEqual({ kind: "cue", positionSec: 42 });
    expect(planPausedAnchor(ENDED, 600, 42)).toEqual({ kind: "cue", positionSec: 42 });
  });

  it("does nothing when the cued player already reports the target", () => {
    expect(planPausedAnchor(CUED, 42, 42)).toEqual({ kind: "none" });
  });

  it("honours a custom tolerance", () => {
    expect(planPausedAnchor(CUED, 42, 42.5, 0.75)).toEqual({ kind: "none" });
    expect(planPausedAnchor(CUED, 42, 44, 0.75)).toEqual({ kind: "cue", positionSec: 44 });
  });
});
