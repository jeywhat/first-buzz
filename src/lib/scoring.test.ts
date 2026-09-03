import { describe, it, expect } from "vitest";
import {
  SCORE_MIN,
  SCORE_MAX,
  MAX_SCORE_DELTA,
  LARGE_DELTA_THRESHOLD,
  normalizeDelta,
  computeNextScore,
  isLargeDelta,
  formatScoreChange,
} from "./scoring";

describe("score constants", () => {
  it("match the rules contract", () => {
    expect(SCORE_MIN).toBe(-99);
    expect(SCORE_MAX).toBe(999);
    expect(MAX_SCORE_DELTA).toBe(20);
    expect(LARGE_DELTA_THRESHOLD).toBe(3);
  });
});

describe("normalizeDelta", () => {
  it("accepts signed integers within ±20", () => {
    for (const d of [-20, -3, -1, 1, 2, 3, 20]) {
      expect(normalizeDelta(d)).toBe(d);
    }
  });
  it("rejects zero, non-integers and out-of-range values", () => {
    expect(() => normalizeDelta(0)).toThrow("scoring:delta-zero");
    expect(() => normalizeDelta(1.5)).toThrow("scoring:delta-not-integer");
    expect(() => normalizeDelta(Number.NaN)).toThrow("scoring:delta-not-integer");
    expect(() => normalizeDelta(21)).toThrow("scoring:delta-out-of-range");
    expect(() => normalizeDelta(-21)).toThrow("scoring:delta-out-of-range");
  });
});

describe("computeNextScore (clamped transaction transform)", () => {
  it("adds and subtracts deltas", () => {
    expect(computeNextScore(5, 1)).toBe(6);
    expect(computeNextScore(5, -2)).toBe(3);
    expect(computeNextScore(null, 3)).toBe(3); // absent score coalesces to 0
    expect(computeNextScore(undefined, -1)).toBe(-1);
  });
  it("clamps to the safe range and stays an integer", () => {
    expect(computeNextScore(999, 3)).toBe(SCORE_MAX);
    expect(computeNextScore(-99, -3)).toBe(SCORE_MIN);
    expect(computeNextScore(998, 20)).toBe(999);
    expect(Number.isInteger(computeNextScore(2.4, 3))).toBe(true);
  });
});

describe("isLargeDelta", () => {
  it("thresholds strictly above |3|", () => {
    expect(isLargeDelta(3)).toBe(false);
    expect(isLargeDelta(-3)).toBe(false);
    expect(isLargeDelta(4)).toBe(true);
    expect(isLargeDelta(-4)).toBe(true);
  });
});

describe("formatScoreChange", () => {
  it("formats toasts for both directions and pluralization", () => {
    expect(formatScoreChange(1, "Alice")).toBe("+1 point for Alice");
    expect(formatScoreChange(3, "Alice")).toBe("+3 points for Alice");
    expect(formatScoreChange(-1, "Bob")).toBe("-1 point for Bob");
    expect(formatScoreChange(-2, "Bob")).toBe("-2 points for Bob");
  });
});
