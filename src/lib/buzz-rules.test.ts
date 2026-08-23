import { describe, expect, it } from "vitest";
import type { Buzz } from "../types";
import { evaluateBuzz, type BuzzContext } from "./buzz-rules";

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
});
