// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBuzzPopup, type BuzzPopupInfo } from "./buzz-popup";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function info(overrides: Partial<BuzzPopupInfo> = {}): BuzzPopupInfo {
  return {
    buzzEventKey: "room:39:u2:1000",
    winnerId: "u2",
    winnerName: "jeywhat",
    winnerColor: "#ff8800",
    isWinnerYou: false,
    isHost: false,
    videoPaused: true,
    animate: false,
    buzzedAt: Date.now() - 4_000,
    videoTime: 446, // 7:26
    serverOffsetMs: 0,
    ...overrides,
  };
}

function mount() {
  const popup = createBuzzPopup();
  document.body.append(popup.root);
  return popup;
}

afterEach(() => {
  document.body.replaceChildren();
});

/* ------------------------------------------------------------------ */
/*  Region                                                             */
/* ------------------------------------------------------------------ */

describe("buzz popup region", () => {
  it("is mounted, empty and a polite live region before any buzz", () => {
    const popup = mount();
    expect(popup.root.className).toBe("vb-buzz-popup-region");
    expect(popup.root.getAttribute("role")).toBe("status");
    expect(popup.root.getAttribute("aria-live")).toBe("polite");
    expect(popup.root.getAttribute("aria-atomic")).toBe("true");
    expect(popup.root.children.length).toBe(0);
  });

  it("keeps the region mounted when hidden (contents replaced, not the container)", () => {
    const popup = mount();
    popup.show(info());
    expect(popup.root.children.length).toBe(1);
    popup.hide("round opened (next buzz)");
    expect(popup.root.className).toBe("vb-buzz-popup-region");
    expect(popup.root.children.length).toBe(0);
    expect(document.querySelector(".vb-buzz-popup")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Buzzed rendering — ALL round metadata lives here, not the buzzer   */
/* ------------------------------------------------------------------ */

describe("buzzed popup content", () => {
  it("renders BUZZED badge, VIDEO PAUSED badge, winner and meta", () => {
    const popup = mount();
    popup.show(info());
    const card = popup.root.querySelector<HTMLElement>(".vb-buzz-popup")!;
    expect(card.dataset.state).toBe("buzzed");

    const header = card.querySelector(".vb-buzz-popup__header")!;
    expect(header.querySelector(".vb-round-badge")!.textContent).toBe("BUZZED");
    expect(header.querySelector(".vb-paused-badge")!.textContent).toBe("VIDEO PAUSED");

    expect(card.querySelector(".vb-buzz-popup__name")!.textContent).toBe("jeywhat");
    expect(card.querySelector(".vb-buzz-popup__headline")!.textContent).toBe(
      "jeywhat buzzed first",
    );
    // Non-winner: no "You buzzed first!" subline.
    expect(card.querySelector(".vb-buzz-popup__subline")!.textContent).toBe("");

    const meta = card.querySelector(".vb-buzz-popup__meta")!;
    expect(meta.querySelector(".vb-buzz-popup__meta-time")!.textContent).toMatch(/s ago|just now/);
    expect(meta.querySelector(".vb-buzz-popup__meta-video")!.textContent).toContain("VIDEO");
    expect(meta.querySelector(".vb-buzz-popup__meta-video")!.textContent).toBe("VIDEO 7:26");
  });

  it("shows the winner-specific message only to the winner", () => {
    const popup = mount();
    popup.show(info({ isWinnerYou: true }));
    expect(popup.root.querySelector(".vb-buzz-popup__subline")!.textContent).toBe(
      "You buzzed first!",
    );
  });

  it("omits the VIDEO PAUSED badge when playback is not paused", () => {
    const popup = mount();
    popup.show(info({ videoPaused: false }));
    expect(popup.root.querySelector(".vb-paused-badge")).toBeNull();
  });

  it("omits meta entries when timestamps are missing (safe fallback)", () => {
    const popup = mount();
    popup.show(info({ buzzedAt: null, videoTime: null }));
    expect(popup.root.querySelector(".vb-buzz-popup__meta-time")).toBeNull();
    expect(popup.root.querySelector(".vb-buzz-popup__meta-video")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Host action                                                        */
/* ------------------------------------------------------------------ */

describe("host action in popup", () => {
  it("offers the single resume action for the host, once per click", () => {
    const onResumeAndNext = vi.fn();
    const popup = mount();
    popup.setActions({ onResumeAndNext });
    popup.show(info({ isHost: true }));
    const bar = popup.root.querySelector<HTMLElement>(".vb-buzz-popup__actions")!;
    expect(bar.hasAttribute("data-disable-buzz-shortcuts")).toBe(true);
    const btn = bar.querySelector<HTMLButtonElement>("button")!;
    btn.click();
    expect(onResumeAndNext).toHaveBeenCalledTimes(1);
    // Rapid-click de-duplication does NOT live here: the button routes to the
    // ONE canonical doResume() in main.ts (resumeLock + RTDB tx state guard),
    // so there is exactly one transition regardless of click count.
  });

  it("offers no action bar for players", () => {
    const popup = mount();
    popup.show(info({ isHost: false }));
    expect(popup.root.querySelector(".vb-buzz-popup__actions")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Staleness / replay safety                                          */
/* ------------------------------------------------------------------ */

describe("popup staleness", () => {
  it("re-rendering the same event key never replays the entrance animation", () => {
    const popup = mount();
    popup.show(info({ animate: true }));
    expect(
      popup.root.querySelector(".vb-buzz-popup")!.classList.contains("vb-buzz-popup--enter"),
    ).toBe(true);
    popup.show(info({ animate: true }));
    expect(
      popup.root.querySelector(".vb-buzz-popup")!.classList.contains("vb-buzz-popup--enter"),
    ).toBe(false);
  });

  it("pending card renders in the same region and clears cleanly", () => {
    const popup = mount();
    popup.setPending(true);
    expect(popup.root.querySelector(".vb-buzz-popup--pending")).not.toBeNull();
    popup.setPending(false);
    expect(popup.root.children.length).toBe(0);
  });
});
