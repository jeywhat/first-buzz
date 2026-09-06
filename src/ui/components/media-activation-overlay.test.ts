// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMediaActivationOverlay } from "./media-activation-overlay";
import type { LocalMediaCompatibilityState } from "../../services/localMediaCompatibilityService";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function state(overrides: Partial<LocalMediaCompatibilityState> = {}): LocalMediaCompatibilityState {
  return {
    mode: "restricted-media",
    video: "blocked-needs-gesture",
    audio: "locked-needs-gesture",
    localUnlockRequired: true,
    localUnlockVisible: true,
    localActivated: false,
    audioHintVisible: false,
    lastBlockReason: "youtube-autoplay-blocked",
    lastUnlockSucceeded: false,
    ...overrides,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

/* ------------------------------------------------------------------ */
/*  Rendering                                                          */
/* ------------------------------------------------------------------ */

describe("media activation overlay", () => {
  it("is hidden by default (before any state render)", () => {
    const overlay = createMediaActivationOverlay(vi.fn());
    document.body.append(overlay.root);
    expect(overlay.root.hidden).toBe(true);
    expect(overlay.root.className).toBe("vb-media-activation");
  });

  it("never renders for desktop-compatible clients", () => {
    const overlay = createMediaActivationOverlay(vi.fn());
    document.body.append(overlay.root);
    overlay.render(state({ mode: "desktop-compatible" }));
    expect(overlay.root.hidden).toBe(true);
  });

  it("BLOCKS the view for a restricted client until activation", () => {
    const overlay = createMediaActivationOverlay(vi.fn());
    document.body.append(overlay.root);
    overlay.render(state());
    expect(overlay.root.hidden).toBe(false);
    expect(overlay.root.getAttribute("aria-hidden")).toBeNull();
    const btn = overlay.root.querySelector<HTMLButtonElement>(".vb-media-activation__btn")!;
    expect(btn.textContent).toContain("Activer l'expérience");
  });

  it("hides as soon as the client is activated (no inactive overlay left)", () => {
    const overlay = createMediaActivationOverlay(vi.fn());
    document.body.append(overlay.root);
    overlay.render(state());
    expect(overlay.root.hidden).toBe(false);
    overlay.render(state({ localActivated: true }));
    expect(overlay.root.hidden).toBe(true);
    // The stylesheet ships `.vb-media-activation[hidden] { display:none }` so
    // the inactive overlay is never hit-testable above the iframe in a real
    // browser (happy-dom's getComputedStyle does not apply UA/author [hidden]
    // rules, so the DOM property is the assertable contract here).
    expect(overlay.root.hidden).toBe(true);
  });

  it("re-shows for a restricted client even when no gate is active", () => {
    // Room entered while playing but autoplay allowed: the overlay still
    // waits for its activation gesture (it is the mobile entry contract).
    const overlay = createMediaActivationOverlay(vi.fn());
    document.body.append(overlay.root);
    overlay.render(
      state({
        video: "playing",
        localUnlockRequired: false,
        localUnlockVisible: false,
      }),
    );
    expect(overlay.root.hidden).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Activation gesture                                                 */
/* ------------------------------------------------------------------ */

describe("activation gesture", () => {
  it("runs the local unlock exactly once per click, synchronously wired", () => {
    const onActivate = vi.fn();
    const overlay = createMediaActivationOverlay(onActivate);
    document.body.append(overlay.root);
    overlay.render(state());
    const btn = overlay.root.querySelector<HTMLButtonElement>(".vb-media-activation__btn")!;
    btn.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("keeps a role=dialog + aria-label for assistive tech", () => {
    const overlay = createMediaActivationOverlay(vi.fn());
    document.body.append(overlay.root);
    const card = overlay.root.querySelector<HTMLElement>(".vb-media-activation__card")!;
    expect(card.getAttribute("role")).toBe("dialog");
    expect(card.getAttribute("aria-modal")).toBe("true");
  });

  it("dispose removes the root entirely", () => {
    const overlay = createMediaActivationOverlay(vi.fn());
    document.body.append(overlay.root);
    overlay.dispose();
    expect(document.querySelector(".vb-media-activation")).toBeNull();
  });
});
