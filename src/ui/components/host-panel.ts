import type { RoundData } from "../../types";

export interface HostPanelCallbacks {
  /** Resumes global playback WITHOUT touching the round or scores. */
  onResume(): void;
  /** Opens the next buzz: clears winner, roundNumber+1, state open. No score/playback change. */
  onOpenNext(): void;
  /** Coherently opens the next buzz AND resumes playback (one video command). */
  onResumeAndNext(): void;
  onNewRound(): void;
  /** Broadcasts the current position to every client (seq bump). */
  onResync(): void;
  onResetScores(): void;
  /** Toggles whether the host may also buzz. */
  onToggleHostBuzz(allow: boolean): void;
}

export interface HostPanelHandles {
  root: HTMLElement;
  /** Drives judgment-button visibility from the authoritative round node. */
  setRound(round: RoundData | null): void;
  /** Drives the manual "New round" shortcut (shown while video is paused). */
  setVideoPlaying(playing: boolean): void;
  /** Disables every control while a moderation write is in flight. */
  setBusy(busy: boolean): void;
  /** Subscribe to modal open/close state for keyboard shortcut suppression. */
  onModalOpenChange(callback: (open: boolean) => void): void;
  /** Reflects the current host-buzz allowance in the toggle. */
  setHostBuzzAllowed(allow: boolean): void;
}

function makeButton(label: string, className: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  return btn;
}

/** Host-only moderation controls. Rules re-enforce host rights server-side. */
export function createHostPanel(cb: HostPanelCallbacks): HostPanelHandles {
  const root = document.createElement("section");
  root.className = "vb-host-panel";

  const label = document.createElement("span");
  label.className = "vb-host-panel__label";
  label.textContent = "Host controls";

  /* Host-buzz toggle — lets the host also play along. */
  const hostBuzzRow = document.createElement("label");
  hostBuzzRow.className = "vb-host-buzz-row";

  const hostBuzzToggle = document.createElement("input");
  hostBuzzToggle.type = "checkbox";
  hostBuzzToggle.className = "vb-host-buzz-toggle";

  const hostBuzzText = document.createElement("span");
  hostBuzzText.className = "vb-host-buzz-text";
  hostBuzzText.textContent = "Host can buzz";

  hostBuzzRow.append(hostBuzzToggle, hostBuzzText);

  /* Post-buzz controls — visible only while a round is "buzzed". */
  const actions = document.createElement("div");
  actions.className = "vb-mod-actions";

  const resumeBtn = makeButton(
    "▶ Resume video",
    "vb-btn vb-btn--small vb-btn--success",
  );
  const openNextBtn = makeButton(
    "Open next buzz",
    "vb-btn vb-btn--primary vb-btn--small",
  );
  const resumeNextBtn = makeButton(
    "Resume + open next buzz",
    "vb-btn vb-btn--small vb-btn--ghost",
  );

  actions.append(resumeBtn, openNextBtn, resumeNextBtn);

  /* Manual round + danger zone */
  const row = document.createElement("div");
  row.className = "vb-host-row";

  const rowLeft = document.createElement("div");
  rowLeft.className = "vb-host-row-left";

  const newRoundBtn = makeButton("New round", "vb-btn vb-btn--primary vb-btn--small");
  const resyncBtn = makeButton("↻ Resync video", "vb-btn vb-btn--ghost vb-btn--small");

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "vb-link-danger";
  resetBtn.textContent = "Reset scores";

  rowLeft.append(newRoundBtn, resyncBtn);
  row.append(rowLeft, resetBtn);

  /* Confirmation modal */
  const modal = document.createElement("div");
  modal.className = "vb-modal";
  modal.hidden = true;

  const modalBox = document.createElement("div");
  modalBox.className = "vb-modal__box";
  modalBox.setAttribute("role", "dialog");
  modalBox.setAttribute("aria-modal", "true");

  const modalTitle = document.createElement("h3");
  modalTitle.className = "vb-modal__title";
  modalTitle.textContent = "Reset all scores?";

  const modalText = document.createElement("p");
  modalText.className = "vb-modal__text";
  modalText.textContent = "Every player's score goes back to 0. This cannot be undone.";

  const modalActions = document.createElement("div");
  modalActions.className = "vb-modal__actions";

  const modalCancel = makeButton("Keep scores", "vb-btn vb-btn--ghost vb-btn--small");
  const modalConfirm = makeButton("Reset to 0", "vb-btn vb-btn--small vb-btn--danger");

  modalActions.append(modalCancel, modalConfirm);
  modalBox.append(modalTitle, modalText, modalActions);
  modal.append(modalBox);

  root.append(label, hostBuzzRow, actions, row);
  root.append(modal);

  /* ---------- state ---------- */

  let round: RoundData | null = null;
  let playing = false;
  let busy = false;
  let hostBuzzAllowed = false;
  let modalCallback: ((open: boolean) => void) | null = null;

  function notifyModalChange(open: boolean): void {
    modalCallback?.(open);
  }

  function render(): void {
    const awaitingVerdict = round?.state === "buzzed";
    // Post-buzz controls: visible while the round waits for the host, hidden
    // entirely otherwise. "Resume video" also hides while already playing.
    actions.hidden = !awaitingVerdict || busy;
    resumeBtn.hidden = !awaitingVerdict || playing;
    openNextBtn.hidden = !awaitingVerdict;
    resumeNextBtn.hidden = !awaitingVerdict;

    // "New round" stays for idle (non-open, non-buzzed) states only, so the
    // buzzed view never offers two competing ways to open a round.
    const canOpenManually =
      !!round && round.state !== "open" && round.state !== "buzzed" && !playing;
    newRoundBtn.hidden = !canOpenManually || busy;
    resyncBtn.disabled = busy;
    resetBtn.disabled = busy;
  }

  function guard(action: () => void): () => void {
    return () => {
      if (!busy) action();
    };
  }

  resumeBtn.addEventListener("click", guard(cb.onResume));
  openNextBtn.addEventListener("click", guard(cb.onOpenNext));
  resumeNextBtn.addEventListener("click", guard(cb.onResumeAndNext));
  newRoundBtn.addEventListener("click", guard(cb.onNewRound));
  resyncBtn.addEventListener("click", guard(cb.onResync));
  resetBtn.addEventListener("click", guard(() => {
    modal.hidden = false;
    notifyModalChange(true);
  }));
  modalCancel.addEventListener("click", () => {
    modal.hidden = true;
    notifyModalChange(false);
  });
  modalConfirm.addEventListener("click", () => {
    modal.hidden = true;
    notifyModalChange(false);
    cb.onResetScores();
  });

  hostBuzzToggle.addEventListener("change", () => {
    hostBuzzAllowed = hostBuzzToggle.checked;
    cb.onToggleHostBuzz(hostBuzzAllowed);
  });

  render();

  return {
    root,
    setRound(value) {
      round = value;
      render();
    },
    setVideoPlaying(value) {
      playing = value;
      render();
    },
    setBusy(value) {
      if (busy === value) return;
      busy = value;
      render();
    },
    onModalOpenChange(callback) {
      modalCallback = callback;
    },
    setHostBuzzAllowed(allow) {
      hostBuzzAllowed = allow;
      hostBuzzToggle.checked = allow;
    },
  };
}
