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
  /** Core control: canonical BUZZ button + keyboard hint (center zone). */
  root: HTMLElement;
  /** Winner card + VIDEO PAUSED pill (arena status zone, above the ring). */
  statusRoot: HTMLElement;
  /** Status line (arena feedback zone, below the ring). */
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

/** Large buzzer with click/touch input; Space handling lives in main.ts. */
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

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vb-buzz-btn";
  btn.textContent = "BUZZ";
  btn.disabled = true;

  // Immediate visual response for touch users (:active is unreliable there).
  const clearPress = (): void => btn.classList.remove("vb-buzz-btn--pressed");
  btn.addEventListener("pointerdown", () => {
    if (!btn.disabled) btn.classList.add("vb-buzz-btn--pressed");
  });
  btn.addEventListener("pointerup", clearPress);
  btn.addEventListener("pointerleave", clearPress);
  btn.addEventListener("pointercancel", clearPress);

  const statusLine = document.createElement("div");
  statusLine.className = "vb-buzz-status";
  statusLine.setAttribute("aria-live", "polite");

  // Split roots: the arena mounts each part in its dedicated zone.
  // Center = button ONLY (no text, no winner info, no hint).
  const root = document.createElement("section");
  root.className = "vb-buzz-core";
  const statusRoot = document.createElement("div");
  statusRoot.className = "vb-buzz-status-stack";
  const feedbackRoot = document.createElement("div");
  feedbackRoot.className = "vb-buzz-feedback";

  // Round state pill — top status zone.
  const roundPill = document.createElement("span");
  roundPill.className = "vb-buzz-round-pill";
  roundPill.hidden = true;

  // Keyboard hint — feedback zone, below the status line.
  const kbdHint = document.createElement("p");
  kbdHint.className = "vb-buzz-kbd-hint";
  kbdHint.textContent = "SPACE / ENTER";

  root.append(btn);
  statusRoot.append(roundPill, pausedPill, winnerCard);
  feedbackRoot.append(statusLine, kbdHint);

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
      btn.textContent = "BUZZ!";
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
    // Arcade state label — information is always duplicated in statusLine.
    const LABELS = {
      pending: "BUZZING…",
      taken: "BUZZED",
      waiting: "WAITING…",
      round_over: "CLOSED",
      host_forbidden: "HOST ONLY",
    } as const;
    let label = "BUZZ!";
    if (externalStatus !== null) label = "OFFLINE";
    else if (enabled) label = "BUZZ!";
    else if (effective.reason === "won") label = "YOU!";
    else if (effective.reason) label = LABELS[effective.reason];
    btn.textContent = label;
    btn.classList.toggle("vb-buzz-btn--enabled", enabled);
    btn.classList.toggle("vb-buzz-btn--won", effective.reason === "won");

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
