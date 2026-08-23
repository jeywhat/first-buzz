import type { RoundData } from "../../types";

export interface HostPanelCallbacks {
  onCorrect(): void;
  onWrong(): void;
  onCancel(): void;
  onNewRound(): void;
  /** Broadcasts the current position to every client (seq bump). */
  onResync(): void;
  onResetScores(): void;
}

export interface HostPanelHandles {
  root: HTMLElement;
  /** Drives judgment-button visibility from the authoritative round node. */
  setRound(round: RoundData | null): void;
  /** Drives the manual "New round" shortcut (shown while video is paused). */
  setVideoPlaying(playing: boolean): void;
  /** Disables every control while a moderation write is in flight. */
  setBusy(busy: boolean): void;
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

  /* Judgment actions after a buzz */
  const actions = document.createElement("div");
  actions.className = "vb-mod-actions";

  const correctBtn = makeButton(
    "Correct answer: +1 and resume",
    "vb-btn vb-btn--small vb-btn--success",
  );
  const wrongBtn = makeButton(
    "Wrong answer: resume without points",
    "vb-btn vb-btn--small vb-btn--ghost",
  );
  const cancelBtn = makeButton(
    "Cancel buzz: reopen the round",
    "vb-btn vb-btn--small vb-btn--ghost",
  );

  actions.append(correctBtn, wrongBtn, cancelBtn);

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

  root.append(label, actions, row);
  root.append(modal);

  /* ---------- state ---------- */

  let round: RoundData | null = null;
  let playing = false;
  let busy = false;

  function render(): void {
    const awaitingVerdict = round?.state === "buzzed";
    actions.hidden = !awaitingVerdict || busy;

    correctBtn.disabled = busy;
    wrongBtn.disabled = busy;
    cancelBtn.disabled = busy;

    // Manual round opening: only when nothing is running and video is parked.
    const canOpenManually = !!round && round.state !== "open" && !playing;
    newRoundBtn.hidden = !canOpenManually || busy;
    resyncBtn.disabled = busy;
    resetBtn.disabled = busy;
  }

  function guard(action: () => void): () => void {
    return () => {
      if (!busy) action();
    };
  }

  correctBtn.addEventListener("click", guard(cb.onCorrect));
  wrongBtn.addEventListener("click", guard(cb.onWrong));
  cancelBtn.addEventListener("click", guard(cb.onCancel));
  newRoundBtn.addEventListener("click", guard(cb.onNewRound));
  resyncBtn.addEventListener("click", guard(cb.onResync));
  resetBtn.addEventListener("click", guard(() => {
    modal.hidden = false;
  }));
  modalCancel.addEventListener("click", () => {
    modal.hidden = true;
  });
  modalConfirm.addEventListener("click", () => {
    modal.hidden = true;
    cb.onResetScores();
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
      busy = value;
      render();
    },
  };
}
