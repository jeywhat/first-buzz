import { describe, expect, it } from "vitest";
import type { VideoState } from "../types";
import {
  computeExpectedPositionSec,
  getDriftToleranceSec,
  isStaleSequence,
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
