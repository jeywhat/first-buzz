import { describe, expect, it } from "vitest";
import type { Buzz } from "../types";
import {
  clampResumeBuzzCooldownMs,
  evaluateBuzz,
  isCooldownExpired,
  isResumeDelayExpired,
  MAX_RESUME_BUZZ_COOLDOWN_MS,
  MIN_RESUME_BUZZ_COOLDOWN_MS,
  RESUME_BUZZ_COOLDOWN_MS,
  RESUME_DELAY_MS,
  type BuzzContext,
} from "./buzz-rules";

function ctx(overrides: Partial<BuzzContext> = {}): BuzzContext {
  return {
    playerId: "player-1",
    viewerIsHost: false,
    allowHostToBuzz: false,
    hasPendingAttempt: false,
    ...overrides,
  };
}

const openRound = { state: "open" as const, buzz: null };

const buzzFrom = (playerId: string): Buzz => ({
  playerId,
  displayName: "Alex",
  buzzedAt: 1_000,
  videoTime: 33.5,
  roundNumber: 2,
});

describe("evaluateBuzz", () => {
  it("enables buzzing for a player on an open, unbuzzed round", () => {
    expect(evaluateBuzz(openRound, ctx())).toEqual({ enabled: true, reason: null });
  });

  it("blocks the host by default even on an open round", () => {
    const result = evaluateBuzz(openRound, ctx({ viewerIsHost: true }));
    expect(result).toEqual({ enabled: false, reason: "host_forbidden" });
  });

  it("allows the host only when allowHostToBuzz is true", () => {
    const result = evaluateBuzz(
      openRound,
      ctx({ viewerIsHost: true, allowHostToBuzz: true }),
    );
    expect(result.enabled).toBe(true);
  });

  it("never allows buzzing for non-hosts when allowHostToBuzz is irrelevant", () => {
    // Sanity: flag only gates hosts.
    expect(evaluateBuzz(openRound, ctx({ allowHostToBuzz: true })).enabled).toBe(true);
  });

  it("pending attempt blocks everything, even a round I would win", () => {
    const round = { state: "open" as const, buzz: null };
    expect(evaluateBuzz(round, ctx({ hasPendingAttempt: true })).reason).toBe("pending");
  });

  it("recognizes my own winning buzz", () => {
    const round = { state: "buzzed" as const, buzz: buzzFrom("player-1") };
    expect(evaluateBuzz(round, ctx())).toEqual({ enabled: false, reason: "won" });
  });

  it("marks the round as taken for everyone else after a buzz", () => {
    const round = { state: "buzzed" as const, buzz: buzzFrom("player-2") };
    expect(evaluateBuzz(round, ctx())).toEqual({ enabled: false, reason: "taken" });
    expect(
      evaluateBuzz(round, ctx({ viewerIsHost: true, allowHostToBuzz: true })).reason,
    ).toBe("taken");
  });

  it("treats an open round that already carries a buzz as taken", () => {
    const round = { state: "open" as const, buzz: buzzFrom("player-2") };
    expect(evaluateBuzz(round, ctx()).reason).toBe("taken");
  });

  it("blocks during idle and closed rounds with distinct reasons", () => {
    expect(evaluateBuzz({ state: "idle" }, ctx()).reason).toBe("waiting");
    expect(evaluateBuzz({ state: "resolved" }, ctx()).reason).toBe("round_over");
    expect(evaluateBuzz({ state: "finished" }, ctx()).reason).toBe("round_over");
  });

  it("blocks everyone during the global cooldown (host included)", () => {
    const round = { state: "cooldown" as const, buzz: null, cooldownStartedAt: 5_000 };
    expect(evaluateBuzz(round, ctx())).toEqual({ enabled: false, reason: "cooldown" });
    expect(evaluateBuzz(round, ctx({ viewerIsHost: true, allowHostToBuzz: true }))).toEqual({
      enabled: false,
      reason: "cooldown",
    });
    expect(evaluateBuzz(round, ctx({ hasPendingAttempt: true })).reason).toBe("pending");
  });
});

describe("isResumeDelayExpired", () => {
  it("is NOT expired during the post-buzz lockout window", () => {
    // buzzed at 5_000, default 1000ms lockout
    expect(isResumeDelayExpired(5_000, 5_999)).toBe(false);
  });

  it("expires exactly at buzzedAt + RESUME_DELAY_MS", () => {
    expect(isResumeDelayExpired(5_000, 6_000)).toBe(true);
    expect(isResumeDelayExpired(5_000, 7_500)).toBe(true);
  });

  it("honors a custom delay duration", () => {
    expect(isResumeDelayExpired(5_000, 5_100, 250)).toBe(false);
    expect(isResumeDelayExpired(5_000, 5_250, 250)).toBe(true);
  });

  it("fails OPEN on a missing or invalid anchor (host never locked out)", () => {
    expect(isResumeDelayExpired(undefined, Number.MIN_SAFE_INTEGER)).toBe(true);
    expect(isResumeDelayExpired(null, Number.MIN_SAFE_INTEGER)).toBe(true);
    expect(isResumeDelayExpired(Number.NaN, Number.MIN_SAFE_INTEGER)).toBe(true);
  });

  it("exposes the documented default delay", () => {
    expect(RESUME_DELAY_MS).toBe(1000);
  });
});

describe("isCooldownExpired", () => {
  it("is not expired before the cooldown duration elapses", () => {
    // resumed at 5_000, default 350ms window
    expect(isCooldownExpired(5_000, 5_349)).toBe(false);
  });

  it("expires exactly at cooldownStartedAt + cooldownMs", () => {
    expect(isCooldownExpired(5_000, 5_350)).toBe(true);
    expect(isCooldownExpired(5_000, 6_000)).toBe(true);
  });

  it("honors a custom cooldown duration", () => {
    expect(isCooldownExpired(5_000, 5_999, 1000)).toBe(false);
    expect(isCooldownExpired(5_000, 6_000, 1000)).toBe(true);
  });

  it("never expires without a server time anchor", () => {
    expect(isCooldownExpired(undefined, Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(isCooldownExpired(null, Number.MAX_SAFE_INTEGER)).toBe(false);
    // Malformed anchors are rejected too.
    expect(isCooldownExpired(Number.NaN, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("exposes the documented default and clamping bounds", () => {
    expect(RESUME_BUZZ_COOLDOWN_MS).toBe(350);
    expect(MIN_RESUME_BUZZ_COOLDOWN_MS).toBe(0);
    expect(MAX_RESUME_BUZZ_COOLDOWN_MS).toBe(1000);
    expect(clampResumeBuzzCooldownMs(-50)).toBe(0);
    expect(clampResumeBuzzCooldownMs(500)).toBe(500);
    expect(clampResumeBuzzCooldownMs(5000)).toBe(1000);
    expect(clampResumeBuzzCooldownMs(Number.NaN)).toBe(RESUME_BUZZ_COOLDOWN_MS);
  });
});
