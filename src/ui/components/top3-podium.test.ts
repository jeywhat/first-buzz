// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createTop3Podium } from "./top3-podium";
import type { ParticipantView } from "../../types/participant";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function player(overrides: Partial<ParticipantView> = {}): ParticipantView {
  return {
    uid: overrides.uid ?? `u${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? "Alex",
    color: overrides.color ?? "#ff8800",
    score: overrides.score ?? 0,
    presenceState: overrides.presenceState ?? "online",
    isHost: false,
  };
}

/* ------------------------------------------------------------------ */
/*  Rendering                                                          */
/* ------------------------------------------------------------------ */

describe("top3 podium", () => {
  it("hides the pill for an empty room", () => {
    const podium = createTop3Podium();
    podium.setParticipants([]);
    expect(podium.root.hidden).toBe(true);
    expect(podium.root.querySelectorAll(".vb-top3-player").length).toBe(0);
  });

  it("ranks by score descending and highlights the leader in amber", () => {
    const podium = createTop3Podium();
    podium.setParticipants([
      player({ uid: "1", name: "Alex", score: 1420 }),
      player({ uid: "2", name: "Sarah_99", score: 1680, color: "#ffd43b" }),
      player({ uid: "3", name: "Emma_K", score: 1240 }),
      player({ uid: "4", name: "Bob", score: 100 }),
    ]);
    expect(podium.root.hidden).toBe(false);
    const slots = podium.root.querySelectorAll<HTMLElement>(".vb-top3-player");
    expect(slots.length).toBe(3); // top 3 only — Bob excluded
    expect(podium.root.textContent).not.toContain("Bob");

    const lead = slots[0]!;
    expect(lead.classList.contains("vb-top3-player--lead")).toBe(true);
    expect(lead.querySelector(".vb-top3-name")!.textContent).toBe("Sarah_99");
    expect(lead.querySelector(".vb-top3-score")!.textContent).toBe("1680");
    expect(lead.querySelector(".vb-top3-medal")!.textContent).toBe("🥇");

    expect(slots[1]!.querySelector(".vb-top3-name")!.textContent).toBe("Alex");
    expect(slots[1]!.querySelector(".vb-top3-medal")!.textContent).toBe("🥈");
    expect(slots[1]!.classList.contains("vb-top3-player--lead")).toBe(false);
    expect(slots[2]!.querySelector(".vb-top3-name")!.textContent).toBe("Emma_K");
    expect(slots[2]!.querySelector(".vb-top3-medal")!.textContent).toBe("🥉");
  });

  it("renders 1 or 2 players without inventing a third slot", () => {
    const podium = createTop3Podium();
    podium.setParticipants([player({ name: "Alex", score: 5 })]);
    expect(podium.root.hidden).toBe(false);
    expect(podium.root.querySelectorAll(".vb-top3-player").length).toBe(1);
    podium.setParticipants([
      player({ name: "A", score: 5 }),
      player({ name: "B", score: 3 }),
    ]);
    expect(podium.root.querySelectorAll(".vb-top3-player").length).toBe(2);
    // Only one divider for two players.
    expect(podium.root.querySelectorAll(".vb-top3-divider").length).toBe(1);
  });

  it("avatars carry the player color and initials", () => {
    const podium = createTop3Podium();
    podium.setParticipants([player({ name: "Sarah_99", color: "#123456" })]);
    const avatar = podium.root.querySelector<HTMLElement>(".vb-top3-avatar")!;
    // Initials = first letter of each word (same rule as the identity card):
    // "Sarah_99" is one word → "S".
    expect(avatar.textContent).toBe("S");
    expect(avatar.style.getPropertyValue("--player-color")).toBe("#123456");
  });

  it("renders player names as textContent only (XSS-safe)", () => {
    const podium = createTop3Podium();
    podium.setParticipants([player({ name: "<img src=x onerror=alert(1)>" })]);
    expect(podium.root.querySelector("img")).toBeNull();
    expect(podium.root.querySelector(".vb-top3-name")!.textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("re-renders idempotently when the same list arrives twice", () => {
    const podium = createTop3Podium();
    const players = [
      player({ uid: "1", name: "Alex", score: 10 }),
      player({ uid: "2", name: "Sarah", score: 20 }),
    ];
    podium.setParticipants(players);
    podium.setParticipants(players);
    expect(podium.root.querySelectorAll(".vb-top3-player").length).toBe(2);
  });
});
