/**
 * Settings modal — opened from a gear button in the topbar.
 *
 * The modal is a fixed overlay (reuses .vb-modal styles) containing a content
 * slot filled by main.ts (the sound panel today). While open it reports state
 * via onOpenChange so the global Space/Enter buzz shortcut can suppress
 * itself — same contract as the host panel's confirmation modal.
 */
export interface SettingsModalHandles {
  /** Gear button — append to the topbar. */
  button: HTMLButtonElement;
  /** Fixed overlay root — append OUTSIDE the topbar (page root). */
  modalRoot: HTMLElement;
  /** Content slot inside the modal box. */
  content: HTMLElement;
  onOpenChange(callback: (open: boolean) => void): void;
  isOpen(): boolean;
  /** Opens the modal (e.g. from a keyboard shortcut). */
  open(): void;
  dispose(): void;
}

export function createSettingsModal(): SettingsModalHandles {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "vb-icon-toggle vb-settings-toggle";
  button.textContent = "⚙️";
  button.setAttribute("aria-label", "Open settings");
  button.setAttribute("aria-haspopup", "dialog");

  const modal = document.createElement("div");
  modal.className = "vb-modal vb-settings-modal";
  modal.hidden = true;

  const box = document.createElement("div");
  box.className = "vb-modal__box vb-settings-modal__box";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Settings");

  const header = document.createElement("div");
  header.className = "vb-settings-modal__header";

  const title = document.createElement("h2");
  title.className = "vb-modal__title";
  title.textContent = "Settings";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "vb-icon-toggle vb-settings-modal__close";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close settings");

  header.append(title, closeBtn);

  const content = document.createElement("div");
  content.className = "vb-settings-modal__content";

  box.append(header, content);
  modal.append(box);

  let callback: ((open: boolean) => void) | null = null;
  let open = false;

  function notify(next: boolean): void {
    open = next;
    modal.hidden = !next;
    button.setAttribute("aria-expanded", String(next));
    callback?.(next);
  }

  button.addEventListener("click", () => notify(!open));
  closeBtn.addEventListener("click", () => notify(false));
  // Backdrop click closes (clicks inside the box stop propagation).
  modal.addEventListener("click", (e) => {
    if (e.target === modal) notify(false);
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && open) notify(false);
    },
    { passive: true },
  );

  return {
    button,
    modalRoot: modal,
    content,
    onOpenChange(cb) {
      callback = cb;
    },
    isOpen() {
      return open;
    },
    open() {
      if (!open) notify(true);
    },
    dispose() {
      notify(false);
      callback = null;
    },
  };
}
