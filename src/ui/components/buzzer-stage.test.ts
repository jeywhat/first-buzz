// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createBuzzerStage } from "./buzzer-stage";
import { createBuzzPanel } from "./buzz-panel";
import type { ParticipantView } from "../../types/participant";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function player(overrides: Partial<ParticipantView> = {}): ParticipantView {
  return {
    uid: overrides.uid ?? "u1",
    name: overrides.name ?? "Alice",
    color: "#ff4b72",
    score: 0,
    presenceState: overrides.presenceState ?? "online",
    isHost: false,
  };
}

function mountWithPanel() {
  const onBuzz = () => undefined;
  const stage = createBuzzerStage();
  const panel = createBuzzPanel({ onBuzz });
  stage.mountBuzzPanel(panel.root, panel.feedbackRoot);
  document.body.append(stage.root);
  return { stage, panel };
}

afterEach(() => {
  document.body.replaceChildren();
});

/* ------------------------------------------------------------------ */
/*  Structure                                                          */
/* ------------------------------------------------------------------ */

describe("buzzer stage structure", () => {
  it("renders the buzzer stage with header, zone and live status", () => {
    const { stage } = mountWithPanel();
    const section = stage.root;
    expect(section.classList.contains("vb-buzzer-stage")).toBe(true);
    expect(section.getAttribute("aria-labelledby")).toBe("buzzer-stage-title");

    const title = section.querySelector<HTMLHeadingElement>("#buzzer-stage-title")!;
    expect(title.textContent).toBe("Buzzer");

    // Zone holds the ONE canonical buzzer button; no nested button inside it.
    const zone = section.querySelector<HTMLElement>(".vb-mechanical-buzzer-zone")!;
    expect(zone.querySelectorAll("button").length).toBe(1);

    const live = section.querySelector<HTMLElement>(".vb-buzzer-status")!;
    expect(liveStatus(live)).toBe(true);

    function liveStatus(el: HTMLElement): boolean {
      return el.getAttribute("aria-live") === "polite" && el.getAttribute("aria-atomic") === "true";
    }
  });

  it("contains exactly one mechanical buzzer in the whole stage", () => {
    const { stage } = mountWithPanel();
    expect(stage.root.querySelectorAll(".vb-mechanical-buzzer").length).toBe(1);
    // No leftover arena stations/rings in the DOM.
    expect(stage.root.querySelectorAll(".vb-arena-player, .vb-arena-rings").length).toBe(0);
  });

  it("shows the online count from setRoomData", () => {
    const { stage } = mountWithPanel();
    stage.setRoomData(
      [player({ uid: "u1" }), player({ uid: "u2", presenceState: "offline" })],
      null,
      "u1",
    );
    expect(stage.root.querySelector(".vb-buzzer-online")!.textContent).toBe("1 ONLINE");
  });

  it("has NO conditional metadata strip — geometry stays stable across states", () => {
    const { stage, panel } = mountWithPanel();
    // The old .vb-buzzer-status-stack (round pill / VIDEO PAUSED / winner
    // card) caused the buzzed-state layout shift; it must not exist.
    expect(stage.root.querySelector(".vb-buzzer-status-stack")).toBeNull();
    for (const sel of [".vb-winner-card", ".vb-paused-pill", ".vb-buzz-round-pill"]) {
      expect(stage.root.querySelector(sel)).toBeNull();
    }
    // Exactly three stable rows: header, zone, live status.
    const rows = Array.from(stage.root.children).map((c) => (c as HTMLElement).className);
    expect(rows).toEqual([
      "vb-buzzer-stage-header",
      "vb-mechanical-buzzer-zone",
      "vb-buzzer-status",
    ]);
    // Zone holds exactly one interactive element — the buzzer button.
    const zone = stage.root.querySelector<HTMLElement>(".vb-mechanical-buzzer-zone")!;
    expect(zone.querySelectorAll("button").length).toBe(1);
    // A buzzed round must not add anything to the stage.
    panel.setRound({
      number: 8,
      state: "buzzed",
      buzz: {
        playerId: "u2",
        displayName: "Bob",
        buzzedAt: Date.now(),
        videoTime: 3,
        roundNumber: 8,
      },
    });
    expect(stage.root.children.length).toBe(3);
    expect(zone.querySelectorAll("button").length).toBe(1);
  });

  it("the stage live region carries the buzz status line", () => {
    const { stage, panel } = mountWithPanel();
    panel.setRound({ number: 7, state: "idle" });
    const live = stage.root.querySelector<HTMLElement>(".vb-buzzer-status")!;
    expect(live.querySelector(".vb-buzz-status")!.textContent).toBe(
      "Waiting for the host to open a round…",
    );
  });

  it("dispose is safe", () => {
    const { stage } = mountWithPanel();
    expect(() => stage.dispose()).not.toThrow();
  });
});
