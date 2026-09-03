import { describe, expect, it } from "vitest";
import {
  canTriggerBuzzFromKeyboard,
  type KeyboardBuzzState,
  type KeyboardInput,
} from "./keyboard-buzz";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const baseState: KeyboardBuzzState = {
  buzzEnabled: true,
  connected: true,
  modalOpen: false,
};

function key(overrides: Partial<KeyboardInput> = {}): KeyboardInput {
  return {
    code: "Space",
    repeat: false,
    isComposing: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    altGraph: false,
    ...overrides,
  };
}

interface MockElement {
  tagName: string;
  isContentEditable: boolean;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  classList: { contains(cls: string): boolean };
  closest(selector: string): MockElement | null;
  parentElement: MockElement | null;
}

/**
 * Mock HTMLElement-like shape for the pure predicate.
 * No real DOM required — the predicate only reads tagName, isContentEditable,
 * hasAttribute, getAttribute, classList.contains, closest, parentElement.
 */
function mockEl(shape: {
  tagName?: string;
  isContentEditable?: boolean;
  attributes?: Record<string, string>;
  classList?: string[];
  parentElement?: MockElement | null;
}): MockElement {
  const attrs = new Map(Object.entries(shape.attributes ?? {}));
  const classes = new Set(shape.classList ?? []);
  const parent = shape.parentElement === undefined ? null : shape.parentElement;

  const node: MockElement = {
    tagName: (shape.tagName ?? "DIV").toUpperCase(),
    isContentEditable: shape.isContentEditable ?? false,
    hasAttribute(name: string): boolean {
      return attrs.has(name);
    },
    getAttribute(name: string): string | null {
      return attrs.get(name) ?? null;
    },
    classList: {
      contains(cls: string): boolean {
        return classes.has(cls);
      },
    },
    closest(selector: string): MockElement | null {
      if (selector === ".vb-modal" && classes.has("vb-modal")) return node;
      return parent?.closest(selector) ?? null;
    },
    get parentElement(): MockElement | null {
      return parent;
    },
  };
  return node;
}

/* ------------------------------------------------------------------ */
/*  canTriggerBuzzFromKeyboard — unit tests                             */
/* ------------------------------------------------------------------ */

describe("canTriggerBuzzFromKeyboard", () => {
  /* ---- eligible keys ---- */

  it("allows Space on an open round with no focus", () => {
    expect(canTriggerBuzzFromKeyboard(key(), baseState, null)).toBe(true);
  });

  it("allows Enter", () => {
    expect(
      canTriggerBuzzFromKeyboard(key({ code: "Enter" }), baseState, null),
    ).toBe(true);
  });

  it("allows NumpadEnter", () => {
    expect(
      canTriggerBuzzFromKeyboard(key({ code: "NumpadEnter" }), baseState, null),
    ).toBe(true);
  });

  /* ---- rejected keys ---- */

  it("rejects unrelated key codes", () => {
    expect(
      canTriggerBuzzFromKeyboard(key({ code: "KeyA" }), baseState, null),
    ).toBe(false);
    expect(
      canTriggerBuzzFromKeyboard(key({ code: "Escape" }), baseState, null),
    ).toBe(false);
  });

  /* ---- repeat / hold ---- */

  it("rejects a held Space (event.repeat)", () => {
    expect(
      canTriggerBuzzFromKeyboard(key({ repeat: true }), baseState, null),
    ).toBe(false);
  });

  it("rejects a held Enter", () => {
    expect(
      canTriggerBuzzFromKeyboard(
        key({ code: "Enter", repeat: true }),
        baseState,
        null,
      ),
    ).toBe(false);
  });

  /* ---- IME composition ---- */

  it("rejects events during IME composition", () => {
    expect(
      canTriggerBuzzFromKeyboard(key({ isComposing: true }), baseState, null),
    ).toBe(false);
  });

  /* ---- modifier keys ---- */

  it("rejects Ctrl+Space", () => {
    expect(
      canTriggerBuzzFromKeyboard(key({ ctrlKey: true }), baseState, null),
    ).toBe(false);
  });

  it("rejects Alt+Space", () => {
    expect(
      canTriggerBuzzFromKeyboard(key({ altKey: true }), baseState, null),
    ).toBe(false);
  });

  it("rejects Meta+Space", () => {
    expect(
      canTriggerBuzzFromKeyboard(key({ metaKey: true }), baseState, null),
    ).toBe(false);
  });

  it("rejects AltGraph+Space", () => {
    expect(
      canTriggerBuzzFromKeyboard(key({ altGraph: true }), baseState, null),
    ).toBe(false);
  });

  /* ---- game state guards ---- */

  it("rejects when buzz is disabled (round closed, pending, etc.)", () => {
    expect(
      canTriggerBuzzFromKeyboard(key(), { ...baseState, buzzEnabled: false }, null),
    ).toBe(false);
  });

  it("rejects when disconnected from Firebase", () => {
    expect(
      canTriggerBuzzFromKeyboard(key(), { ...baseState, connected: false }, null),
    ).toBe(false);
  });

  it("rejects when a modal/dialog is open", () => {
    expect(
      canTriggerBuzzFromKeyboard(key(), { ...baseState, modalOpen: true }, null),
    ).toBe(false);
  });

  /* ---- focus: excluded HTML tags ---- */

  it("rejects focus inside an INPUT", () => {
    const el = mockEl({ tagName: "input" });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, el)).toBe(false);
  });

  it("rejects focus inside a TEXTAREA", () => {
    const el = mockEl({ tagName: "textarea" });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, el)).toBe(false);
  });

  it("rejects focus inside a SELECT", () => {
    const el = mockEl({ tagName: "select" });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, el)).toBe(false);
  });

  it("rejects focus on a BUTTON (the BUZZ button)", () => {
    const el = mockEl({ tagName: "button" });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, el)).toBe(false);
  });

  it("rejects focus on a link (A tag)", () => {
    const el = mockEl({ tagName: "a" });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, el)).toBe(false);
  });

  /* ---- focus: contenteditable ---- */

  it("rejects focus inside a contenteditable element", () => {
    const el = mockEl({ isContentEditable: true });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, el)).toBe(false);
  });

  /* ---- focus: data-disable-buzz-shortcuts ---- */

  it("rejects an element marked with data-disable-buzz-shortcuts", () => {
    const el = mockEl({ attributes: { "data-disable-buzz-shortcuts": "" } });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, el)).toBe(false);
  });

  /* ---- focus: modal container ---- */

  it("rejects focus inside a .vb-modal element", () => {
    const el = mockEl({ classList: ["vb-modal"] });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, el)).toBe(false);
  });

  it("rejects focus inside a [role=dialog] element", () => {
    const el = mockEl({ attributes: { role: "dialog" } });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, el)).toBe(false);
  });

  /* ---- focus: interactive ARIA roles ---- */

  it("rejects focus on an element with role=menuitem", () => {
    const el = mockEl({ attributes: { role: "menuitem" } });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, el)).toBe(false);
  });

  it("rejects focus on an element with role=tab", () => {
    const el = mockEl({ attributes: { role: "tab" } });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, el)).toBe(false);
  });

  /* ---- native button focused: no double invocation ---- */

  it("rejects Space when the BUZZ button is focused (prevents double)", () => {
    // When the native button is focused, Space would fire both our global
    // listener AND the browser's native click. The predicate must reject
    // so only the native click path fires.
    const btn = mockEl({ tagName: "button" });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, btn)).toBe(false);
  });

  it("rejects Enter when the BUZZ button is focused (prevents double)", () => {
    const btn = mockEl({ tagName: "button" });
    expect(
      canTriggerBuzzFromKeyboard(key({ code: "Enter" }), baseState, btn),
    ).toBe(false);
  });

  /* ---- display-name input field ---- */

  it("rejects Space while typing a display name", () => {
    const input = mockEl({ tagName: "input" });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, input)).toBe(false);
  });

  /* ---- host video URL field ---- */

  it("rejects Space while typing a YouTube URL", () => {
    const input = mockEl({ tagName: "input" });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, input)).toBe(false);
  });

  /* ---- two simultaneous windows: only Firebase wins ---- */

  it("does not prevent the predicate from returning true for two eligible users", () => {
    // Both users have enabled buzz, connected, no modal, no focus issues.
    // The predicate alone can't decide the winner — that's the RTDB transaction.
    expect(canTriggerBuzzFromKeyboard(key(), baseState, null)).toBe(true);
    expect(canTriggerBuzzFromKeyboard(key(), baseState, null)).toBe(true);
    // Both are eligible; Firebase transaction handles the first-writer-wins.
  });

  /* ---- disconnected mode ---- */

  it("rejects all keys when disconnected, even with open round", () => {
    const disconnected: KeyboardBuzzState = {
      buzzEnabled: true,
      connected: false,
      modalOpen: false,
    };
    expect(canTriggerBuzzFromKeyboard(key(), disconnected, null)).toBe(false);
    expect(
      canTriggerBuzzFromKeyboard(key({ code: "Enter" }), disconnected, null),
    ).toBe(false);
    expect(
      canTriggerBuzzFromKeyboard(
        key({ code: "NumpadEnter" }),
        disconnected,
        null,
      ),
    ).toBe(false);
  });

  /* ---- mobile: touch-only devices ---- */

  it("predicate does not check pointer type — mobile filtering is CSS only", () => {
    // The predicate is pointer-type-agnostic. Mobile devices still get
    // keyboard events from external keyboards. Touch buzzing is handled
    // by the button's click handler, which is independent.
    expect(canTriggerBuzzFromKeyboard(key(), baseState, null)).toBe(true);
  });

  /* ---- nested parent: modal ancestor ---- */

  it("rejects focus on a child inside a .vb-modal ancestor", () => {
    const modal = mockEl({ classList: ["vb-modal"] });
    const child = mockEl({ tagName: "div", parentElement: modal });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, child)).toBe(false);
  });

  it("rejects focus on a child inside a [role=dialog] ancestor", () => {
    const dialog = mockEl({ attributes: { role: "dialog" } });
    const child = mockEl({ tagName: "div", parentElement: dialog });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, child)).toBe(false);
  });

  it("rejects focus inside an ancestor marked data-disable-buzz-shortcuts (scoring form)", () => {
    const form = mockEl({ attributes: { "data-disable-buzz-shortcuts": "" } });
    const input = mockEl({ tagName: "input", parentElement: form });
    expect(canTriggerBuzzFromKeyboard(key(), baseState, input)).toBe(false);
  });
});
