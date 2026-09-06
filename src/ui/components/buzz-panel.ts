import { evaluateBuzz, type BuzzBlockReason, type BuzzContext } from "../../lib/buzz-rules";
import type { RoundData } from "../../types";

const REASON_MESSAGES: Record<BuzzBlockReason, string> = {
  pending: "Buzzing…",
  won: "You buzzed first!",
  taken: "Too late — someone already buzzed.",
  waiting: "Waiting for the host to open a round…",
  cooldown: "Get ready — next buzz opening…",
  round_over: "This round is over.",
  host_forbidden: "Hosts cannot buzz in this room.",
};

export interface BuzzPanelHandles {
  /** Core control: the ONE mechanical buzzer button (stage zone). */
  root: HTMLElement;
  /** Short local status line (stage .vb-buzzer-status live region). */
  feedbackRoot: HTMLElement;
  /** Drives the button's action state from the authoritative round node. */
  setRound(round: RoundData): void;
  setContext(ctx: BuzzContext): void;
  /** External override (e.g. offline) shown instead of the computed reason. */
  setStatus(message: string | null): void;
  markPending(pending: boolean): void;
  /**
   * Shows "You buzzed first!" immediately AFTER the transaction committed —
   * never before server confirmation. Cleared once the authoritative buzz
   * snapshot lands or a new round opens.
   */
  pinMyWin(): void;
  /** True while THIS viewer is shown the interactive host RESUME action. */
  isResumeActionAvailable(): boolean;
  /** Disables the buzzer while the host resume/next-round write is in flight. */
  markResumePending(pending: boolean): void;
  isEnabled(): boolean;
  dispose(): void;
}

/**
 * Visual states rendered as data-state on the button (derived ONLY from the
 * existing round/ctx/external state — no new decision logic):
 *   idle | ready | pending | buzzed | resume | cooldown | disabled
 *   | disconnected | host-only | round-closed | no-video
 */
export type BuzzerVisualState =
  | "idle"
  | "ready"
  | "pending"
  | "buzzed"
  | "resume"
  | "cooldown"
  | "disabled"
  | "disconnected"
  | "host-only"
  | "round-closed"
  | "no-video";

/**
 * THE canonical buzzer: one native <button> rendered as the large mechanical
 * buzzer (shadow + dark base + red dome). Click/touch AND the global
 * Space/Enter shortcut (main.ts) both funnel into the same onBuzz() →
 * attemptBuzz() transaction. While the round is 'buzzed' and the viewer is
 * the HOST, the SAME button becomes the single "Resume & open buzz" action
 * (mint state → onHostResume) — no double click, no second control, no new
 * transaction. No winner decision, no Firebase writes here.
 *
 * GEOMETRIC STABILITY: this component renders ONLY the button and one short
 * status line with a reserved min-height. Round metadata (round pill, VIDEO
 * PAUSED, winner name/time/video position) lives exclusively in the
 * .vb-buzz-popup-region below the video (buzz-popup.ts) — never inside the
 * buzzer zone, so the buzzer never moves or resizes across round states.
 */
export function createBuzzPanel(opts: { onBuzz(): void; onHostResume?(): void }): BuzzPanelHandles {
  /* ---------- THE mechanical buzzer (single interactive element) ---------- */

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vb-mechanical-buzzer";
  btn.id = "master-buzzer";
  btn.setAttribute("aria-label", "Buzz");
  // State text (WAITING…, YOU!, NO VIDEO…) lives in the stage live region.
  btn.setAttribute("aria-describedby", "vb-buzzer-status");
  btn.disabled = true;

  // Decorative layers — never interactive, never announced.
  const shadow = document.createElement("span");
  shadow.className = "vb-buzzer-shadow";
  shadow.setAttribute("aria-hidden", "true");

  const base = document.createElement("span");
  base.className = "vb-buzzer-base";
  base.setAttribute("aria-hidden", "true");

  const dome = document.createElement("span");
  dome.className = "vb-buzzer-button";

  const icon = document.createElement("span");
  icon.className = "vb-buzzer-icon";
  icon.textContent = "📣";
  icon.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "vb-buzzer-text";
  label.textContent = "BUZZ!";

  const hint = document.createElement("span");
  hint.className = "vb-buzzer-key-hint";
  hint.textContent = "SPACE / ENTER";
  hint.setAttribute("aria-hidden", "true");

  dome.append(icon, label, hint);
  btn.append(shadow, base, dome);

  // Immediate visual response for touch users (:active is unreliable there).
  const clearPress = (): void => btn.classList.remove("is-pressed");
  btn.addEventListener("pointerdown", () => {
    if (!btn.disabled) btn.classList.add("is-pressed");
  });
  btn.addEventListener("pointerup", clearPress);
  btn.addEventListener("pointerleave", clearPress);
  btn.addEventListener("pointercancel", clearPress);

  // Live region state line — the STAGE wrapper carries aria-live/atomic so
  // there is exactly one live region (no nested announcements).
  const statusLine = document.createElement("div");
  statusLine.className = "vb-buzz-status";

  // Split roots: the stage mounts each part in its dedicated zone. The
  // status stack is intentionally GONE — its conditional metadata was the
  // source of the buzzed-state layout shift (see module doc).
  const root = document.createElement("section");
  root.className = "vb-buzz-core";
  const feedbackRoot = document.createElement("div");
  feedbackRoot.className = "vb-buzz-feedback";

  root.append(btn);
  feedbackRoot.append(statusLine);

  /* ---------- state ---------- */

  let ctx: BuzzContext = {
    playerId: "",
    viewerIsHost: false,
    allowHostToBuzz: false,
    hasPendingAttempt: false,
  };
  let round: RoundData | null = null;
  let externalStatus: string | null = null;
  let enabled = false;
  let pinnedWin = false;
  /** Host resume/next-round write in flight (local, transient). */
  let resumePending = false;
  /** True while the button's single action IS the host resume action. */
  let resumeMode = false;

  function render(): void {
    if (!round) {
      enabled = false;
      resumeMode = false;
      btn.disabled = true;
      btn.dataset.state = "idle";
      btn.setAttribute("aria-label", "Buzz");
      label.textContent = "BUZZ!";
      hint.textContent = "SPACE / ENTER";
      statusLine.textContent = externalStatus ?? "";
      return;
    }

    const result = evaluateBuzz(round, ctx);
    // A confirmed commit (pinMyWin) may outrun the cached snapshot: keep
    // showing MY win until the authoritative buzz state arrives.
    const effective =
      pinnedWin && round.buzz?.playerId !== ctx.playerId
        ? { enabled: false as const, reason: "won" as const }
        : result;

    // Host "Resume & open buzz": while the round is 'buzzed' the host's ONE
    // mechanical buzzer becomes a single clear resume action (mint state).
    // Available regardless of the host's own buzzing permission — resuming
    // is not buzzing. The cooldown countdown is intentionally a static
    // GET READY label: the ~350ms window is far too short for a meaningful
    // countdown and eligibility is a server-anchored comparison, not a timer.
    resumeMode =
      round.state === "buzzed" &&
      ctx.viewerIsHost &&
      typeof opts.onHostResume === "function" &&
      externalStatus === null &&
      !resumePending;

    enabled = resumeMode || (effective.enabled && externalStatus === null);

    btn.disabled = !enabled;

    // Arcade state label + machine-readable state. The full, readable
    // message is always duplicated in the stage live region.
    let state: BuzzerVisualState;
    let label_text: string;
    let aria_label: string;
    if (externalStatus !== null) {
      const offline = /connection|reconnect|offline/i.test(externalStatus);
      state = offline ? "disconnected" : "no-video";
      label_text = offline ? "OFFLINE" : "NO VIDEO";
      aria_label = offline ? "Offline" : "No video";
      resumeMode = false;
    } else if (resumeMode) {
      state = "resume";
      label_text = "RESUME";
      aria_label = "Resume video and open next buzz round";
    } else if (resumePending && round.state === "buzzed" && ctx.viewerIsHost) {
      state = "resume";
      label_text = "RESUMING…";
      aria_label = "Resuming video and opening next buzz round";
    } else if (enabled) {
      state = "ready";
      label_text = "BUZZ!";
      aria_label = "Buzz";
    } else {
      const LABELS: Record<BuzzBlockReason, string> = {
        pending: "BUZZING…",
        won: "YOU!",
        taken: "WAITING",
        waiting: "WAITING…",
        cooldown: "GET READY",
        round_over: "CLOSED",
        host_forbidden: "HOST ONLY",
      };
      label_text = effective.reason ? LABELS[effective.reason] : "BUZZ!";
      const ARIAS: Record<BuzzBlockReason, string> = {
        pending: "Buzzing",
        won: "You buzzed first",
        taken: "Waiting for next round",
        waiting: "Waiting for the host to open a round",
        cooldown: "Get ready for the next buzz round",
        round_over: "Round closed",
        host_forbidden: "Hosts cannot buzz in this room",
      };
      aria_label = effective.reason ? ARIAS[effective.reason] : "Buzz";
      state =
        effective.reason === "won"
          ? "buzzed"
          : effective.reason === "taken"
            ? "buzzed"
            : effective.reason === "pending"
              ? "pending"
              : effective.reason === "cooldown"
                ? "cooldown"
                : effective.reason === "host_forbidden"
                  ? "host-only"
                  : "round-closed";
    }
    btn.dataset.state = state;
    label.textContent = label_text;
    btn.setAttribute("aria-label", aria_label);
    hint.textContent = resumeMode ? "OPEN BUZZ" : "SPACE / ENTER";
    btn.classList.toggle("vb-mechanical-buzzer--enabled", enabled);
    btn.classList.toggle("vb-mechanical-buzzer--won", effective.reason === "won");

    statusLine.classList.toggle(
      "vb-buzz-status--won",
      !resumeMode && effective.reason === "won",
    );
    statusLine.classList.toggle(
      "vb-buzz-status--alert",
      !resumeMode && effective.reason === "taken",
    );
    statusLine.textContent =
      externalStatus ??
      (resumeMode
        ? "Resume the video and open the next buzz round"
        : resumePending && ctx.viewerIsHost
          ? "Resuming video and opening the next buzz…"
          : effective.reason
            ? REASON_MESSAGES[effective.reason]
            : "");
  }

  btn.addEventListener("click", () => {
    if (!enabled) return;
    // One button, one current action: while the round is 'buzzed' the host's
    // click resumes + opens the next buzz; otherwise it's the canonical buzz.
    if (resumeMode) opts.onHostResume?.();
    else opts.onBuzz();
  });

  return {
    root,
    feedbackRoot,
    setRound(value) {
      round = value;
      if (round.state === "open" && !round.buzz) pinnedWin = false;
      if (round.buzz?.playerId === ctx.playerId) pinnedWin = false;
      render();
    },
    setContext(value) {
      ctx = value;
      render();
    },
    setStatus(message) {
      externalStatus = message;
      render();
    },
    markPending(pending) {
      ctx = { ...ctx, hasPendingAttempt: pending };
      render();
    },
    pinMyWin() {
      pinnedWin = true;
      render();
    },
    isResumeActionAvailable() {
      // Only when the interactive RESUME action is actually on offer —
      // never during the resume write itself.
      return enabled && resumeMode;
    },
    markResumePending(pending) {
      resumePending = pending;
      render();
    },
    isEnabled() {
      return enabled;
    },
    dispose() {
      // No timers of its own — the button lifecycle is the DOM's.
    },
  };
}
