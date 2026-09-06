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
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("WAITING");
    expect(btn.getAttribute("aria-label")).toBe("Waiting for next round");
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
/*  Host resume & cooldown states                                      */
/* ------------------------------------------------------------------ */

describe("host resume & open buzz", () => {
  const hostCtx = (allowBuzz = true) => ({
    playerId: "host-1",
    viewerIsHost: true,
    allowHostToBuzz: allowBuzz,
    hasPendingAttempt: false,
  });

  const buzzedRound = (buzzedBy = "player-2"): RoundData =>
    round({
      state: "buzzed",
      buzz: {
        playerId: buzzedBy,
        displayName: "Bob",
        buzzedAt: Date.now(),
        videoTime: 3,
        roundNumber: 7,
      },
    });

  function mountHost(onHostResume: () => void) {
    const panel = createBuzzPanel({ onBuzz: vi.fn(), onHostResume });
    document.body.append(panel.root);
    panel.setRound(buzzedRound());
    panel.setContext(hostCtx());
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    return { panel, btn };
  }

  it("transforms the ONE buzzer into RESUME + OPEN BUZZ for the host", () => {
    const onHostResume = vi.fn();
    const { btn, panel } = mountHost(onHostResume);
    expect(btn.disabled).toBe(false);
    expect(btn.dataset.state).toBe("resume");
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("RESUME");
    expect(btn.querySelector(".vb-buzzer-key-hint")!.textContent).toBe("OPEN BUZZ");
    expect(btn.getAttribute("aria-label")).toBe("Resume video and open next buzz round");
    expect(panel.isResumeActionAvailable()).toBe(true);
    // The button IS interactive — but its action is the host resume, not a
    // normal buzz (keyboard dispatch checks isResumeActionAvailable first).
    expect(panel.isEnabled()).toBe(true);
  });

  it("offers the resume action regardless of the host buzzing permission", () => {
    const onHostResume = vi.fn();
    const panel = createBuzzPanel({ onBuzz: vi.fn(), onHostResume });
    document.body.append(panel.root);
    panel.setRound(buzzedRound());
    panel.setContext(hostCtx(false));
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.dataset.state).toBe("resume");
    expect(panel.isResumeActionAvailable()).toBe(true);
  });

  it("fires the canonical resume action once per click", () => {
    const onHostResume = vi.fn();
    const { btn } = mountHost(onHostResume);
    btn.click();
    expect(onHostResume).toHaveBeenCalledTimes(1);
  });

  it("cannot re-enter while the resume write is pending (rapid clicks)", () => {
    const onHostResume = vi.fn();
    const panel = createBuzzPanel({
      onBuzz: vi.fn(),
      onHostResume: () => {
        onHostResume();
        panel.markResumePending(true); // mirrors main.ts doResume lock
      },
    });
    document.body.append(panel.root);
    panel.setRound(buzzedRound());
    panel.setContext(hostCtx());
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    btn.click();
    btn.click(); // second rapid click → guarded
    expect(onHostResume).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("RESUMING…");
    expect(btn.getAttribute("aria-label")).toBe("Resuming video and opening next buzz round");
    expect(panel.isResumeActionAvailable()).toBe(false);
  });

  it("players never see the resume action (WAITING instead)", () => {
    const onHostResume = vi.fn();
    const panel = createBuzzPanel({ onBuzz: vi.fn(), onHostResume });
    document.body.append(panel.root);
    panel.setRound(buzzedRound());
    panel.setContext(playerCtx());
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.dataset.state).toBe("buzzed");
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("WAITING");
    expect(panel.isResumeActionAvailable()).toBe(false);
    btn.click();
    expect(onHostResume).not.toHaveBeenCalled();
  });

  it("keeps the winner card and VIDEO PAUSED pill visible during resume", () => {
    const { panel } = mountHost(vi.fn());
    // Winner card + paused pill live in the status strip root.
    const winnerCard = panel.statusRoot.querySelector<HTMLElement>(".vb-winner-card")!;
    const pausedPill = panel.statusRoot.querySelector<HTMLElement>(".vb-paused-pill")!;
    expect(winnerCard.hidden).toBe(false);
    expect(pausedPill.hidden).toBe(false);
  });
});

describe("global cooldown state", () => {
  const cooldownRound: Partial<RoundData> = {
    state: "cooldown",
    cooldownStartedAt: 5_000,
  };

  it("shows GET READY disabled for players", () => {
    const { onBuzz, panel } = mount();
    panel.setRound(round(cooldownRound));
    panel.setContext(playerCtx());
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.dataset.state).toBe("cooldown");
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("GET READY");
    expect(btn.getAttribute("aria-label")).toBe("Get ready for the next buzz round");
    btn.click();
    expect(onBuzz).not.toHaveBeenCalled();
  });

  it("shows GET READY disabled for the host too (no instant re-buzz)", () => {
    const onHostResume = vi.fn();
    const panel = createBuzzPanel({ onBuzz: vi.fn(), onHostResume });
    document.body.append(panel.root);
    panel.setRound(round(cooldownRound));
    panel.setContext({
      playerId: "host-1",
      viewerIsHost: true,
      allowHostToBuzz: true,
      hasPendingAttempt: false,
    });
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.dataset.state).toBe("cooldown");
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("GET READY");
    expect(panel.isResumeActionAvailable()).toBe(false);
    btn.click();
    expect(onHostResume).not.toHaveBeenCalled();
  });

  it("returns to normal BUZZ once the cooldown resolves to an open round", () => {
    const { panel } = mount();
    panel.setRound(round(cooldownRound));
    panel.setContext(playerCtx());
    expect(panel.isEnabled()).toBe(false);
    panel.setRound(round({ state: "open", number: 8 }));
    expect(panel.isEnabled()).toBe(true);
    const btn = panel.root.querySelector<HTMLButtonElement>("button")!;
    expect(btn.disabled).toBe(false);
    expect(btn.dataset.state).toBe("ready");
    expect(btn.querySelector(".vb-buzzer-text")!.textContent).toBe("BUZZ!");
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
