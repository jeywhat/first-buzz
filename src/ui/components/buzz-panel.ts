import { evaluateBuzz, type BuzzBlockReason, type BuzzContext } from "../../lib/buzz-rules";
import type { RoundData } from "../../types";
import { formatTime } from "./youtube-player";

const REASON_MESSAGES: Record<BuzzBlockReason, string> = {
  pending: "Buzzing…",
  won: "You buzzed first!",
  taken: "Too late — someone already buzzed.",
  waiting: "Waiting for the host to open a round…",
  round_over: "This round is over.",
  host_forbidden: "Hosts cannot buzz in this room.",
};

export interface BuzzPanelHandles {
  /** Core control: the ONE mechanical buzzer button (stage zone). */
  root: HTMLElement;
  /** Round pill + VIDEO PAUSED pill + winner card (stage status strip). */
  statusRoot: HTMLElement;
  /** Status line (stage .vb-buzzer-status live region). */
  feedbackRoot: HTMLElement;
  /** Drives availability + winner card from the authoritative round node. */
  setRound(round: RoundData): void;
  setContext(ctx: BuzzContext): void;
  setWinnerColor(color: string | null): void;
  setServerOffset(ms: number): void;
  /** External override (e.g. offline) shown instead of the computed reason. */
  setStatus(message: string | null): void;
  markPending(pending: boolean): void;
  /**
   * Shows "You buzzed first!" immediately AFTER the transaction committed —
   * never before server confirmation. Cleared once the authoritative buzz
   * snapshot lands or a new round opens.
   */
  pinMyWin(): void;
  isEnabled(): boolean;
  dispose(): void;
}

/**
 * Visual states rendered as data-state on the button (derived ONLY from the
 * existing round/ctx/external state — no new decision logic):
 *   idle | ready | pending | buzzed | disabled | disconnected
 *   | host-only | round-closed | no-video
 */
export type BuzzerVisualState =
  | "idle"
  | "ready"
  | "pending"
  | "buzzed"
  | "disabled"
  | "disconnected"
  | "host-only"
  | "round-closed"
  | "no-video";

/**
 * THE canonical buzzer: one native <button> rendered as the large mechanical
 * buzzer (shadow + dark base + red dome). Click/touch AND the global
 * Space/Enter shortcut (main.ts) both funnel into the same onBuzz() →
 * attemptBuzz() transaction. No winner decision, no Firebase writes here.
 */
export function createBuzzPanel(opts: { onBuzz(): void }): BuzzPanelHandles {
  const winnerCard = document.createElement("div");
  winnerCard.className = "vb-winner-card";
  winnerCard.hidden = true;
  // Announces the winner (name) to assistive tech exactly once per buzz.
  winnerCard.setAttribute("role", "status");
  winnerCard.setAttribute("aria-live", "polite");

  // Shown to everyone while the round waits for the host's verdict.
  const pausedPill = document.createElement("div");
  pausedPill.className = "vb-paused-pill";
  pausedPill.hidden = true;
  pausedPill.textContent = "VIDEO PAUSED";

  const winnerChip = document.createElement("span");
  winnerChip.className = "vb-winner-card__chip";

  // Other players' names: textContent only (XSS-safe).
  const winnerName = document.createElement("strong");
  winnerName.className = "vb-winner-card__name";

  const winnerMeta = document.createElement("span");
  winnerMeta.className = "vb-winner-card__meta";

  winnerCard.append(winnerChip, winnerName, winnerMeta);

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

  // Split roots: the stage mounts each part in its dedicated zone.
  const root = document.createElement("section");
  root.className = "vb-buzz-core";
  const statusRoot = document.createElement("div");
  statusRoot.className = "vb-buzz-status-stack";
  const feedbackRoot = document.createElement("div");
  feedbackRoot.className = "vb-buzz-feedback";

  // Round state pill — status strip.
  const roundPill = document.createElement("span");
  roundPill.className = "vb-buzz-round-pill";
  roundPill.hidden = true;

  root.append(btn);
  statusRoot.append(roundPill, pausedPill, winnerCard);
  feedbackRoot.append(statusLine);

  /* ---------- state ---------- */

  let ctx: BuzzContext = {
    playerId: "",
    viewerIsHost: false,
    allowHostToBuzz: false,
    hasPendingAttempt: false,
  };
  let round: RoundData | null = null;
  let winnerColor: string | null = null;
  let serverOffsetMs = 0;
  let externalStatus: string | null = null;
  let enabled = false;
  let pinnedWin = false;
  let lastWinnerKey = -1;

  function updateWinnerMeta(): void {
    const buzz = round?.buzz;
    if (!buzz) return;
    const elapsedSec = Math.max(
      0,
      Math.round((Date.now() + serverOffsetMs - buzz.buzzedAt) / 1000),
    );
    const relative = elapsedSec < 2 ? "just now" : `${elapsedSec}s ago`;
    winnerMeta.textContent = `${relative} · video ${formatTime(buzz.videoTime)}`;
  }

  function render(): void {
    if (!round) {
      enabled = false;
      btn.disabled = true;
      btn.dataset.state = "idle";
      label.textContent = "BUZZ!";
      statusLine.textContent = externalStatus ?? "";
      winnerCard.hidden = true;
      return;
    }

    const result = evaluateBuzz(round, ctx);
    // A confirmed commit (pinMyWin) may outrun the cached snapshot: keep
    // showing MY win until the authoritative buzz state arrives.
    const effective =
      pinnedWin && round.buzz?.playerId !== ctx.playerId
        ? { enabled: false as const, reason: "won" as const }
        : result;
    enabled = effective.enabled && externalStatus === null;

    btn.disabled = !enabled;

    // Arcade state label + machine-readable state. The full, readable
    // message is always duplicated in the stage live region.
    let state: BuzzerVisualState;
    let label_text: string;
    if (externalStatus !== null) {
      const offline = /connection|reconnect|offline/i.test(externalStatus);
      state = offline ? "disconnected" : "no-video";
      label_text = offline ? "OFFLINE" : "NO VIDEO";
    } else if (enabled) {
      state = "ready";
      label_text = "BUZZ!";
    } else {
      const LABELS: Record<BuzzBlockReason, string> = {
        pending: "BUZZING…",
        won: "YOU!",
        taken: "BUZZED",
        waiting: "WAITING…",
        round_over: "CLOSED",
        host_forbidden: "HOST ONLY",
      };
      label_text = effective.reason ? LABELS[effective.reason] : "BUZZ!";
      state =
        effective.reason === "won"
          ? "buzzed"
          : effective.reason === "taken"
            ? "buzzed"
            : effective.reason === "pending"
              ? "pending"
              : effective.reason === "host_forbidden"
                ? "host-only"
                : "round-closed";
    }
    btn.dataset.state = state;
    label.textContent = label_text;
    btn.classList.toggle("vb-mechanical-buzzer--enabled", enabled);
    btn.classList.toggle("vb-mechanical-buzzer--won", effective.reason === "won");

    statusLine.classList.toggle("vb-buzz-status--won", effective.reason === "won");
    statusLine.classList.toggle("vb-buzz-status--alert", effective.reason === "taken");
    statusLine.textContent =
      externalStatus ?? (effective.reason ? REASON_MESSAGES[effective.reason] : "");

    const buzz = round.buzz;
    winnerCard.hidden = !buzz;
    if (buzz) {
      winnerName.textContent = buzz.displayName;
      winnerChip.style.backgroundColor = winnerColor ?? "#64748b";
      // Color is reinforcement only — the name carries the information.
      winnerCard.style.borderLeftColor = winnerColor ?? "#64748b";
      updateWinnerMeta();

      // Replay the short pop animation once per new winning round.
      if (buzz.roundNumber !== lastWinnerKey) {
        lastWinnerKey = buzz.roundNumber;
        winnerCard.classList.remove("vb-win-flash");
        void winnerCard.offsetWidth; // restart CSS animation
        winnerCard.classList.add("vb-win-flash");
      }
    } else {
      winnerCard.classList.remove("vb-win-flash");
    }

    pausedPill.hidden = round.state !== "buzzed";
  }

  const ticker = window.setInterval(() => {
    if (!winnerCard.hidden) updateWinnerMeta();
  }, 1000);

  btn.addEventListener("click", () => {
    if (enabled) opts.onBuzz();
  });

  return {
    root,
    statusRoot,
    feedbackRoot,
    setRound(value) {
      round = value;
      if (round.state === "open" && !round.buzz) pinnedWin = false;
      if (round.buzz?.playerId === ctx.playerId) pinnedWin = false;
      roundPill.textContent = `Round #${round.number} · ${round.state}`;
      roundPill.hidden = false;
      render();
    },
    setContext(value) {
      ctx = value;
      render();
    },
    setWinnerColor(color) {
      winnerColor = color;
      render();
    },
    setServerOffset(ms) {
      serverOffsetMs = ms;
      updateWinnerMeta();
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
    isEnabled() {
      return enabled;
    },
    dispose() {
      window.clearInterval(ticker);
    },
  };
}
