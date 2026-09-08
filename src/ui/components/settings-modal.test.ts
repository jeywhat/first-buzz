// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createSettingsModal } from "./settings-modal";

afterEach(() => {
  document.body.replaceChildren();
});

describe("settings modal", () => {
  it("starts closed and toggles from the gear button", () => {
    const modal = createSettingsModal();
    document.body.append(modal.button, modal.modalRoot);
    expect(modal.isOpen()).toBe(false);
    expect(modal.modalRoot.hidden).toBe(true);

    modal.button.click();
    expect(modal.isOpen()).toBe(true);
    expect(modal.modalRoot.hidden).toBe(false);
    expect(modal.button.getAttribute("aria-expanded")).toBe("true");

    modal.button.click();
    expect(modal.isOpen()).toBe(false);
    expect(modal.modalRoot.hidden).toBe(true);
  });

  it("notifies open/close state (keyboard shortcut suppression contract)", () => {
    const modal = createSettingsModal();
    document.body.append(modal.button, modal.modalRoot);
    const states: boolean[] = [];
    modal.onOpenChange((open) => states.push(open));
    modal.button.click();
    modal.open(); // already open → no duplicate notification
    modal.modalRoot.querySelector<HTMLButtonElement>(".vb-settings-modal__close")!.click();
    expect(states).toEqual([true, false]);
  });

  it("closes on backdrop click and Escape, not on inside clicks", () => {
    const modal = createSettingsModal();
    document.body.append(modal.button, modal.modalRoot);
    modal.open();

    modal.content.click(); // inside → stays open
    expect(modal.isOpen()).toBe(true);

    modal.modalRoot.click(); // backdrop → closes
    expect(modal.isOpen()).toBe(false);

    modal.open();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(modal.isOpen()).toBe(false);
  });

  it("exposes a content slot for the sound panel", () => {
    const modal = createSettingsModal();
    const slot = document.createElement("p");
    slot.textContent = "sound panel";
    modal.content.append(slot);
    expect(modal.content.contains(slot)).toBe(true);
  });

  it("dispose closes and detaches the callback", () => {
    const modal = createSettingsModal();
    document.body.append(modal.button, modal.modalRoot);
    const states: boolean[] = [];
    modal.onOpenChange((open) => states.push(open));
    modal.open();
    modal.dispose();
    expect(modal.isOpen()).toBe(false);
    modal.open(); // callback detached → no new notification
    expect(states).toEqual([true, false]);
  });
});
