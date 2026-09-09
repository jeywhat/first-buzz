export interface HostPanelCallbacks {
  /** Broadcasts the current position to every client (seq bump). */
  onResync(): void;
  onResetScores(): void;
  /** Toggles whether the host may also buzz. */
  onToggleHostBuzz(allow: boolean): void;
}

export interface HostPanelHandles {
  root: HTMLElement;
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

/**
 * Host-only moderation controls, rendered INSIDE the settings drawer.
 * Trimmed to its essentials: the resume/open-next actions live on the
 * canonical mechanical buzzer and the buzz popup (single path), so this
 * panel keeps only the manual "New round" shortcut, resync, host-buzz
 * toggle and score reset. Rules re-enforce host rights server-side.
 */
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

  /* Manual resync + danger zone */
  const row = document.createElement("div");
  row.className = "vb-host-row";

  const rowLeft = document.createElement("div");
  rowLeft.className = "vb-host-row-left";

  const resyncBtn = makeButton("↻ Resync video", "vb-btn vb-btn--ghost vb-btn--small");

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "vb-link-danger";
  resetBtn.textContent = "Reset scores";

  rowLeft.append(resyncBtn);
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

  root.append(label, hostBuzzRow, row);
  root.append(modal);

  /* ---------- state ---------- */

  let busy = false;
  let hostBuzzAllowed = false;
  let modalCallback: ((open: boolean) => void) | null = null;

  function notifyModalChange(open: boolean): void {
    modalCallback?.(open);
  }

  function render(): void {
    resyncBtn.disabled = busy;
    resetBtn.disabled = busy;
  }

  function guard(action: () => void): () => void {
    return () => {
      if (!busy) action();
    };
  }

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
