import type { LocalMediaCompatibilityState } from "../../services/localMediaCompatibilityService";

export interface MediaUnlockCardHandles {
  root: HTMLElement;
  /** Renders the card for the current local compatibility state. */
  render(state: LocalMediaCompatibilityState): void;
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * LOCAL "Tap to start" control for restricted-media clients.
 *
 * - Normal-flow card BELOW the video — never an overlay on the iframe,
 *   never `.vb-video-error`, never position:fixed.
 * - Only rendered when the local compatibility service reports an actual
 *   local block (`localUnlockVisible`) or, in a compact audio-only variant,
 *   when video works but game sounds still need a gesture.
 * - Never rendered for desktop-compatible clients (the service never sets
 *   the flags; this component also keeps its root hidden by default).
 * - On success it shows a short local confirmation and unmounts; it does
 *   not push the buzzer layout (it lives in the video column like the buzz
 *   popup region).
 */
export function createMediaUnlockCard(
  onUnlock: () => Promise<unknown>,
): MediaUnlockCardHandles {
  const root = el("div", "vb-media-unlock");
  root.hidden = true;

  const title = el("p", "vb-media-unlock__title", "Tap to start");
  const text = el(
    "p",
    "vb-media-unlock__text",
    "Your browser blocked automatic playback. One tap syncs this device with the room — it changes nothing for other players.",
  );
  const button = el("button", "vb-btn vb-btn--primary vb-media-unlock__btn", "▶ Start video");
  button.type = "button";
  const hint = el(
    "p",
    "vb-media-unlock__hint",
    "🔊 Game sounds also need one tap on this device.",
  );
  const done = el("p", "vb-media-unlock__done", "✓ Started — enjoy the game!");

  button.addEventListener("click", () => {
    // Trusted gesture: the handler runs the local media APIs immediately.
    void onUnlock();
  });

  let doneTimer = 0;

  function showVariants(opts: {
    videoBlocked: boolean;
    audioHint: boolean;
    mode: "gate" | "hint" | "done";
  }): void {
    root.hidden = false;
    root.dataset.mode = opts.mode;
    title.hidden = opts.mode !== "gate";
    text.hidden = opts.mode !== "gate";
    button.hidden = opts.mode === "done";
    button.textContent = opts.videoBlocked ? "▶ Start video" : "🔊 Enable game sounds";
    button.setAttribute(
      "aria-label",
      opts.videoBlocked
        ? "Start video playback and unlock game sounds on this device"
        : "Enable game sounds on this device",
    );
    hint.hidden = !(opts.audioHint && opts.mode !== "done");
    done.hidden = opts.mode !== "done";
  }

  return {
    root,
    render(state) {
      if (state.lastUnlockSucceeded === false && state.localUnlockVisible) {
        // Gate (video blocked) — reset any stale confirmation.
        showVariants({
          videoBlocked: true,
          audioHint: state.audioHintVisible,
          mode: "gate",
        });
        return;
      }
      if (state.localUnlockVisible) {
        showVariants({
          videoBlocked: true,
          audioHint: state.audioHintVisible,
          mode: "gate",
        });
        return;
      }
      if (state.audioHintVisible) {
        showVariants({ videoBlocked: false, audioHint: true, mode: "hint" });
        return;
      }
      // Everything playing locally → brief confirmation, then hide.
      if (!root.hidden && root.dataset.mode === "gate") {
        showVariants({ videoBlocked: false, audioHint: false, mode: "done" });
        window.clearTimeout(doneTimer);
        doneTimer = window.setTimeout(() => {
          root.hidden = true;
          root.dataset.mode = "";
        }, 2500);
        return;
      }
      root.hidden = true;
      root.dataset.mode = "";
    },
    dispose() {
      window.clearTimeout(doneTimer);
      root.remove();
    },
  };
}
