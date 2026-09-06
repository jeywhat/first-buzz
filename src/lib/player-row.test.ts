import { describe, expect, it } from "vitest";
import {
  comparePlayers,
  formatScoreAdjustmentToast,
} from "./player-row";
import type { ParticipantView } from "../types/participant";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function player(overrides: Partial<ParticipantView> = {}): ParticipantView {
  return {
    uid: overrides.uid ?? "u1",
    name: overrides.name ?? "Alice",
    color: "#ff4b72",
    score: overrides.score ?? 0,
    presenceState: overrides.presenceState ?? "online",
    isHost: overrides.isHost ?? false,
    joinedAt: overrides.joinedAt ?? 1000,
  };
}

/* ------------------------------------------------------------------ */
/*  comparePlayers — documented ranking rule                           */
/* ------------------------------------------------------------------ */

describe("comparePlayers (documented order: presence, score desc, join, name)", () => {
  it("ranks online players before offline players", () => {
    const online = player({ uid: "a", presenceState: "online", score: 0 });
    const offline = player({ uid: "b", presenceState: "offline", score: 99 });
    expect(comparePlayers(offline, online)).toBeGreaterThan(0);
  });

  it("ranks reconnecting between online and offline", () => {
    const online = player({ uid: "a", presenceState: "online" });
    const reconnecting = player({ uid: "b", presenceState: "reconnecting" });
    const offline = player({ uid: "c", presenceState: "offline" });
    expect(comparePlayers(online, reconnecting)).toBeLessThan(0);
    expect(comparePlayers(reconnecting, offline)).toBeLessThan(0);
  });

  it("breaks presence ties by score descending", () => {
    const high = player({ uid: "a", score: 10 });
    const low = player({ uid: "b", score: 3 });
    expect(comparePlayers(low, high)).toBeGreaterThan(0);
  });

  it("breaks score ties by join order", () => {
    const first = player({ uid: "a", score: 5, joinedAt: 100 });
    const second = player({ uid: "b", score: 5, joinedAt: 200 });
    expect(comparePlayers(second, first)).toBeGreaterThan(0);
  });

  it("is deterministic: sorting twice yields the same order (stable rows)", () => {
    const list = [
      player({ uid: "a", score: 5, joinedAt: 200 }),
      player({ uid: "b", score: 9, joinedAt: 100, presenceState: "reconnecting" }),
      player({ uid: "c", score: 5, joinedAt: 100 }),
      player({ uid: "d", score: 1, presenceState: "offline" }),
    ];
    const first = [...list].sort(comparePlayers).map((p) => p.uid);
    const second = [...list].sort(comparePlayers).map((p) => p.uid);
    expect(first).toEqual(second);
  });

  it("keeps relative order for a score change that does not change ranking", () => {
    const alice = player({ uid: "a", score: 5, joinedAt: 100 });
    const bob = player({ uid: "b", score: 3, joinedAt: 200 });
    // Alice +1 → 6; ranking (6 > 3) unchanged.
    const before = [alice, bob].sort(comparePlayers).map((p) => p.uid);
    const after = [{ ...alice, score: 6 }, bob].sort(comparePlayers).map((p) => p.uid);
    expect(after).toEqual(before);
  });
});

/* ------------------------------------------------------------------ */
/*  formatScoreAdjustmentToast                                         */
/* ------------------------------------------------------------------ */

describe("formatScoreAdjustmentToast", () => {
  it('formats +1 as "Added 1 point to {name}"', () => {
    expect(formatScoreAdjustmentToast(1, "Alice")).toBe("Added 1 point to Alice");
  });

  it('formats −1 as "Removed 1 point from {name}"', () => {
    expect(formatScoreAdjustmentToast(-1, "Bob")).toBe("Removed 1 point from Bob");
  });

  it("formats larger deltas with plural wording", () => {
    expect(formatScoreAdjustmentToast(3, "Carol")).toBe("Added 3 points to Carol");
    expect(formatScoreAdjustmentToast(-2, "Dave")).toBe("Removed 2 points from Dave");
  });
});
