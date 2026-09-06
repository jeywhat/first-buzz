/**
 * Theme handling: light (default) / dark, persisted in localStorage,
 * falling back to the OS preference. The pre-paint script in index.html
 * sets `data-theme` on <html> before first render to avoid a flash.
 */

const KEY = "vb-theme";

export type Theme = "light" | "dark";

const CANVAS = { light: "#eef2f9", dark: "#13151d" };

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function resolve(): Theme {
  return stored() ?? (systemDark() ? "dark" : "light");
}

function updateMeta(t: Theme): void {
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    m.setAttribute("content", CANVAS[t]);
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // storage unavailable — theme applies for the session only
  }
  updateMeta(t);
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

/**
 * Self-syncing theme toggle button (moon/sun). Safe to create in several
 * places — every instance re-syncs on click and on OS scheme changes.
 */
export function createThemeToggle(): HTMLButtonElement {
  const btn = el();
  const sync = (): void => {
    const t = currentTheme();
    btn.textContent = t === "dark" ? "☀️" : "🌙";
    btn.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
  };
  btn.addEventListener("click", () => {
    toggleTheme();
    sync();
  });
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (!stored()) {
        applyTheme(resolve());
        sync();
      }
    });
  sync();
  return btn;
}

function el(): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "vb-icon-toggle vb-theme-toggle";
  return b;
}
