// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { canTriggerBuzzFromKeyboard } from "../../lib/keyboard-buzz";
import { createBuzzPanel } from "./buzz-panel";
import type { RoundData } from "../../types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function round(overrides: Partial<RoundData> = {}): RoundData {
  return {
    number: 7,
    state: "open",
    ...overrides,
  };
}

function mount() {
  const onBuzz = vi.fn();
  const panel = createBuzzPanel({ onBuzz });
  document.body.append(panel.root);
  return { onBuzz, panel };
}

afterEach(() => {
  document.body.replaceChildren();
});

const playerCtx = (uid = "me") => ({
  playerId: uid,
  viewerIsHost: false,
  allowHostToBuzz: false,
  hasPendingAttempt: false,
});

/* ------------------------------------------------------------------ */
/*  Structure                                                          */
/* ------------------------------------------------------------------ */

describe("mechanical buzzer structure", () => {
  it("renders exactly ONE native mechanical buzzer button", () => {
    const { panel } = mount();
    const btns = panel.root.querySelectorAll<HTMLButtonElement>("button");
    expect(btns.length).toBe(1);
    const btn = btns[0]!;
    expect(btn.classList.contains("vb-mechanical-buzzer")).toBe(true);
    expect(btn.id).toBe("master-buzzer");
    expect(btn.type).toBe("button");
    expect(btn.getAttribute("aria-label")).toBe("Buzz");
    // Decorative layers are never announced and never interactive.
    for (const cls of ["vb-buzzer-shadow", "vb-buzzer-base"]) {
      expect(btn.querySelector(`.${cls}`)!.getAttribute("aria-hidden")).toBe("true");
    }
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("BUZZ!");
    expect(btn.querySelector(".vb-buzzer-key-hint")!.textContent).toBe("SPACE / ENTER");
  });

  it("is disabled until an open round arrives", () => {
    const { panel } = mount();
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.disabled).toBe(true);
    panel.setRound(round({ state: "open" }));
    expect(btn.disabled).toBe(false);
    expect(panel.isEnabled()).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Canonical buzz flow                                                */
/* ------------------------------------------------------------------ */

describe("canonical buzz flow", () => {
  it("calls the canonical buzz action exactly once per click", () => {
    // Mirrors main.ts wiring: doBuzz() marks the attempt pending
    // synchronously, so a rapid second click cannot re-enter.
    const onBuzz = vi.fn();
    const panel = createBuzzPanel({
      onBuzz: () => {
        onBuzz();
        panel.markPending(true);
      },
    });
    document.body.append(panel.root);
    panel.setRound(round({ state: "open" }));
    panel.setContext(playerCtx());
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    btn.click();
    btn.click(); // transaction already in flight → guarded
    expect(onBuzz).toHaveBeenCalledTimes(1);
  });

  it("does not buzz while pending (markPending blocks re-entry)", () => {
    const { onBuzz, panel } = mount();
    panel.setRound(round({ state: "open" }));
    panel.setContext(playerCtx());
    panel.markPending(true);
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.dataset.state).toBe("pending");
    btn.click();
    expect(onBuzz).not.toHaveBeenCalled();
  });

  it("locked buzzed state disables the buzzer without awarding points", () => {
    const { panel } = mount();
    panel.setRound(
      round({
        state: "buzzed",
        buzz: {
          playerId: "other",
          displayName: "Bob",
          buzzedAt: Date.now(),
          videoTime: 3,
          roundNumber: 7,
        },
      }),
    );
    panel.setContext(playerCtx());
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.dataset.state).toBe("buzzed");
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("BUZZED");
  });

  it("winner state comes exclusively from the round snapshot", () => {
    const { panel } = mount();
    panel.setRound(
      round({
        state: "buzzed",
        buzz: {
          playerId: "me",
          displayName: "Alice",
          buzzedAt: Date.now(),
          videoTime: 3,
          roundNumber: 7,
        },
      }),
    );
    panel.setContext(playerCtx());
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.dataset.state).toBe("buzzed");
    expect(btn.classList.contains("vb-mechanical-buzzer--won")).toBe(true);
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("YOU!");
  });

  it("component exposes no scoring or playback handles", () => {
    const { panel } = mount();
    const handles = panel as unknown as Record<string, unknown>;
    expect(handles.setParticipants).toBeUndefined();
    expect(handles.awardPoints).toBeUndefined();
    expect(handles.requestPlay).toBeUndefined();
    expect(handles.requestPause).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Derived disabled states                                            */
/* ------------------------------------------------------------------ */

describe("derived disabled states", () => {
  it("no-video external status disables the buzzer with NO VIDEO", () => {
    const { panel } = mount();
    panel.setRound(round({ state: "open" }));
    panel.setContext(playerCtx());
    panel.setStatus("Waiting for the host to choose a video");
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.dataset.state).toBe("no-video");
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("NO VIDEO");
  });

  it("disconnected external status disables the buzzer with OFFLINE", () => {
    const { panel } = mount();
    panel.setRound(round({ state: "open" }));
    panel.setContext(playerCtx());
    panel.setStatus("Connection lost");
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.dataset.state).toBe("disconnected");
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("OFFLINE");
  });

  it("host-forbidden shows HOST ONLY and stays disabled", () => {
    const { onBuzz, panel } = mount();
    panel.setRound(round({ state: "open" }));
    panel.setContext({
      playerId: "me",
      viewerIsHost: true,
      allowHostToBuzz: false,
      hasPendingAttempt: false,
    });
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.dataset.state).toBe("host-only");
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("HOST ONLY");
    btn.click();
    expect(onBuzz).not.toHaveBeenCalled();
  });

  it("idle round shows WAITING… and stays disabled", () => {
    const { panel } = mount();
    panel.setRound(round({ state: "idle" }));
    panel.setContext(playerCtx());
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("WAITING…");
  });
});

/* ------------------------------------------------------------------ */
/*  Keyboard semantics (single global listener, no double trigger)     */
/* ------------------------------------------------------------------ */

describe("keyboard semantics", () => {
  const base = { buzzEnabled: true, connected: true, modalOpen: false };

  function key(overrides: Partial<Parameters<typeof canTriggerBuzzFromKeyboard>[0]> = {}) {
    return {
      code: "Space",
      repeat: false,
      isComposing: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      altGraph: false,
      ...overrides,
    };
  }

  const btnShape = {
    tagName: "BUTTON",
    isContentEditable: false,
    hasAttribute: () => false,
    getAttribute: () => null,
    classList: { contains: () => false },
    closest: () => null,
    parentElement: null,
  };

  it("does NOT fire the global buzz while the buzzer button is focused", () => {
    // Native click activation handles it — the global listener must skip
    // BUTTON focus so one press can never trigger the transaction twice.
    expect(canTriggerBuzzFromKeyboard(key(), base, btnShape)).toBe(false);
  });

  it("Space / Enter / NumpadEnter remain eligible with no button focus", () => {
    for (const code of ["Space", "Enter", "NumpadEnter"]) {
      expect(canTriggerBuzzFromKeyboard(key({ code }), base, null)).toBe(true);
    }
  });

  it("ignores repeated keydown and modifier combos", () => {
    expect(canTriggerBuzzFromKeyboard(key({ repeat: true }), base, null)).toBe(false);
    expect(canTriggerBuzzFromKeyboard(key({ metaKey: true }), base, null)).toBe(false);
    expect(canTriggerBuzzFromKeyboard(key({ altKey: true }), base, null)).toBe(false);
  });
});
