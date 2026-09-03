/**
 * Keyboard shortcut system for the buzzer.
 *
 * Pure predicate + global listener lifecycle. Both the visible BUZZ button
 * and keyboard shortcuts funnel through the same canonical `doBuzz()` in
 * main.ts — this module only decides WHETHER to trigger it and attaches
 * the single global keydown listener.
 */

/* ------------------------------------------------------------------ */
/*  Pure predicate                                                     */
/* ------------------------------------------------------------------ */

/** Snapshot of game state consumed by the predicate. */
export interface KeyboardBuzzState {
  /** Whether the buzz panel reports buzzing is currently enabled. */
  buzzEnabled: boolean;
  /** Whether the user is connected to Firebase. */
  connected: boolean;
  /** Whether a modal/dialog confirmation is open. */
  modalOpen: boolean;
}

/** Minimal keyboard-event shape — mockable in tests. */
export interface KeyboardInput {
  code: string;
  repeat: boolean;
  isComposing: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  altGraph: boolean;
}

const EXCLUDED_TAGS = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "BUTTON",
  "A",
]);

const EXCLUDED_ROLES = new Set([
  "textbox",
  "searchbox",
  "search",
  "combobox",
  "listbox",
  "spinbutton",
  "slider",
  "checkbox",
  "radio",
  "switch",
  "menu",
  "menubar",
  "menuitem",
  "tab",
  "dialog",
  "alertdialog",
]);

/** Structural focus target — satisfied by HTMLElement, mockable in tests. */
export interface BuzzFocusTarget {
  tagName: string;
  isContentEditable: boolean;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  classList: { contains(cls: string): boolean };
  closest(selector: string): BuzzFocusTarget | null;
  parentElement: BuzzFocusTarget | null;
}

/**
 * Pure predicate: should a keyboard event trigger a buzz attempt?
 *
 * Returns `true` only when ALL of the following hold:
 * - Code is Space, Enter, or NumpadEnter
 * - Not a repeated key hold
 * - Not during IME composition
 * - No modifier key held (Ctrl, Alt, Meta, AltGraph)
 * - Game state allows buzzing (enabled, connected, no modal)
 * - Focus is not inside an excluded element (input, button, link, etc.)
 */
export function canTriggerBuzzFromKeyboard(
  event: KeyboardInput,
  state: KeyboardBuzzState,
  activeElement: BuzzFocusTarget | null,
): boolean {
  /* ---- event-level guards ---- */
  if (event.code !== "Space" && event.code !== "Enter" && event.code !== "NumpadEnter") {
    return false;
  }
  if (event.repeat) return false;
  if (event.isComposing) return false;
  if (event.ctrlKey || event.altKey || event.metaKey || event.altGraph) return false;

  /* ---- game-state guards ---- */
  if (!state.buzzEnabled) return false;
  if (!state.connected) return false;
  if (state.modalOpen) return false;

  /* ---- focus guards ---- */
  if (!activeElement) return true;

  if (EXCLUDED_TAGS.has(activeElement.tagName)) return false;
  if (activeElement.isContentEditable) return false;
  if (activeElement.hasAttribute("data-disable-buzz-shortcuts")) return false;

  // Walk up to check for modal/dialog container or interactive ARIA role.
  let el: BuzzFocusTarget | null = activeElement;
  while (el) {
    const role = el.getAttribute("role");
    if (role && EXCLUDED_ROLES.has(role)) return false;
    if (el.classList.contains("vb-modal") || el.closest?.(".vb-modal")) return false;
    // Convention: any ancestor marked data-disable-buzz-shortcuts (e.g. the
    // manual-scoring form) suppresses global buzz shortcuts while focused.
    if (el.hasAttribute("data-disable-buzz-shortcuts")) return false;
    el = el.parentElement;
  }

  return true;
}

/* ------------------------------------------------------------------ */
/*  Listener lifecycle                                                 */
/* ------------------------------------------------------------------ */

export interface KeyboardBuzzOpts {
  /** Called to read the current game state on each keydown. */
  getState: () => KeyboardBuzzState;
  /** Called when a buzz should be triggered (delegates to canonical doBuzz). */
  onBuzz: () => void;
  /** Dev-only debug logger. */
  onDebug?: (message: string) => void;
}

/**
 * Attaches a single global `keydown` listener to `window`.
 * Returns a cleanup function that removes it.
 *
 * The listener is passive and never blocks unrelated keyboard input.
 */
export function setupKeyboardBuzz(opts: KeyboardBuzzOpts): () => void {
  let buzzCount = 0; // dev-only: asserts at most 1 per keydown

  function handler(event: KeyboardEvent): void {
    buzzCount = 0; // reset per keydown

    const activeEl = document.activeElement as HTMLElement | null;
    const input: KeyboardInput = {
      code: event.code,
      repeat: event.repeat,
      isComposing: event.isComposing,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      altGraph: event.getModifierState?.("AltGraph") ?? false,
    };

    const eligible = canTriggerBuzzFromKeyboard(input, opts.getState(), activeEl);

    if (!eligible) {
      if (import.meta.env.DEV) {
        const state = opts.getState();
        const reasons: string[] = [];
        if (input.repeat) reasons.push("repeat");
        if (input.isComposing) reasons.push("composing");
        if (input.ctrlKey || input.altKey || input.metaKey || input.altGraph) reasons.push("modifier");
        if (!["Space", "Enter", "NumpadEnter"].includes(input.code)) reasons.push(`code=${input.code}`);
        if (!state.buzzEnabled) reasons.push("buzz-disabled");
        if (!state.connected) reasons.push("disconnected");
        if (state.modalOpen) reasons.push("modal-open");
        if (activeEl) {
          if (EXCLUDED_TAGS.has(activeEl.tagName)) reasons.push(`focus=${activeEl.tagName}`);
          if (activeEl.isContentEditable) reasons.push("contenteditable");
          if (activeEl.hasAttribute("data-disable-buzz-shortcuts")) reasons.push("data-disable-buzz-shortcuts");
        }
        if (reasons.length) {
          opts.onDebug?.(`[vb-kbd] ignored: ${reasons.join(", ")}`);
        }
      }
      return;
    }

    // Prevent Space from scrolling and Enter from submitting forms.
    event.preventDefault();
    buzzCount++;
    opts.onBuzz();

    if (import.meta.env.DEV) {
      if (buzzCount !== 1) {
        console.error(`[vb-kbd] ASSERTION FAILED: buzzCount=${buzzCount} on a single keydown`);
      }
      opts.onDebug?.(`[vb-kbd] triggered: ${event.code} (buzzCount=${buzzCount})`);
    }
  }

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
