import type { ParticipantView } from "../../types/participant";
import { isLargeDelta } from "../../lib/scoring";

export interface ManualScoringHandles {
  root: HTMLElement;
  setParticipants(list: ParticipantView[]): void;
  /** Re-reads the CURRENT durable list before mutating (never a stale copy). */
  getCurrent(): ParticipantView[];
  setBusy(busy: boolean): void;
}

export interface ManualScoringOptions {
  /** Performs the canonical adjustPlayerScore call. Resolves after Firebase ack. */
  onAdjust(target: ParticipantView, delta: number, reason: string | null): Promise<void>;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

const EXTENDED_DELTAS = [-3, -2, 2, 3] as const;

/**
 * Host-only manual scoring area. Buzz-independent: works in any round or
 * playback state. The section carries data-disable-buzz-shortcuts so Enter
 * inside its inputs never triggers the global Space/Enter buzz shortcut.
 */
export function createManualScoring(
  opts: ManualScoringOptions,
): ManualScoringHandles {
  const root = el("section", "vb-scoring");
  root.setAttribute("aria-label", "Manual scoring");
  root.setAttribute("data-disable-buzz-shortcuts", "");

  const title = el("h2", "vb-section-title", "Manual scoring");
  root.append(title);
  const rowsBox = el("div", "vb-scoring-rows");

  /* ---------- per-player rows ---------- */
  let current: ParticipantView[] = [];
  let busy = false;

  function setBusy(b: boolean): void {
    busy = b;
    root
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((btn) => (btn.disabled = busy));
    applyBtn.disabled = busy;
  }

  async function guarded(target: ParticipantView, delta: number, reason: string | null): Promise<void> {
    if (busy) return; // dedup quick clicks while a write is pending
    if (isLargeDelta(delta) && !window.confirm(`Apply ${delta > 0 ? "+" : ""}${delta} points to ${target.name}?`)) {
      return;
    }
    setBusy(true);
    try {
      await opts.onAdjust(target, delta, reason);
    } finally {
      setBusy(false);
    }
  }

  function buildRow(p: ParticipantView): HTMLElement {
    const row = el("div", "vb-scoring-row");
    row.dataset.uid = p.uid;

    const chip = el("span", "vb-chip");
    chip.style.backgroundColor = p.color;

    const name = el("span", "vb-scoring-name", p.name);
    name.title = p.presenceState === "offline" ? `${p.name} (offline)` : p.name;
    if (p.presenceState === "offline") row.classList.add("vb-scoring-row--offline");

    const score = el("span", "vb-scoring-value", String(p.score));
    score.dataset.role = "score";

    const plus1 = el("button", "vb-btn vb-btn--small vb-btn--success", "+1");
    plus1.type = "button";
    plus1.setAttribute("aria-label", `Add 1 point to ${p.name}`);
    plus1.addEventListener("click", () => void guarded(p, 1, null));

    const minus1 = el("button", "vb-btn vb-btn--small", "−1");
    minus1.type = "button";
    minus1.classList.add("vb-btn--ghost");
    minus1.setAttribute("aria-label", `Remove 1 point from ${p.name}`);
    minus1.addEventListener("click", () => void guarded(p, -1, null));

    const more = el("details", "vb-scoring-more");
    const summary = el("summary", "vb-scoring-more-summary");
    summary.setAttribute("aria-label", `More score options for ${p.name}`);
    summary.textContent = "⋯";
    const moreBox = el("div", "vb-scoring-more-box");
    for (const d of EXTENDED_DELTAS) {
      const b = el("button", "vb-btn vb-btn--small vb-btn--ghost", d > 0 ? `+${d}` : `−${Math.abs(d)}`);
      b.type = "button";
      b.setAttribute("aria-label", `${d > 0 ? "Add" : "Remove"} ${Math.abs(d)} points ${d > 0 ? "to" : "from"} ${p.name}`);
      b.addEventListener("click", () => {
        more.open = false;
        void guarded(p, d, null);
      });
      moreBox.append(b);
    }
    more.append(summary, moreBox);

    row.append(chip, name, score, minus1, plus1, more);
    return row;
  }

  function updateScoresInPlace(list: ParticipantView[]): void {
    for (const p of list) {
      const row = rowsBox.querySelector<HTMLElement>(`.vb-scoring-row[data-uid="${p.uid}"]`);
      if (!row) continue;
      const scoreEl = row.querySelector<HTMLElement>('[data-role="score"]');
      if (scoreEl) scoreEl.textContent = String(p.score);
      row.classList.toggle("vb-scoring-row--offline", p.presenceState === "offline");
    }
  }

  /* ---------- direct adjustment form ---------- */
  const form = el("form", "vb-scoring-form");
  const select = el("select", "vb-input vb-scoring-select");
  select.setAttribute("aria-label", "Player for manual score change");
  const amount = el("input", "vb-input vb-scoring-amount") as HTMLInputElement;
  amount.type = "number";
  amount.min = "-20";
  amount.max = "20";
  amount.step = "1";
  amount.placeholder = "±20";
  amount.setAttribute("aria-label", "Signed point amount");
  const reason = el("input", "vb-input vb-scoring-reason") as HTMLInputElement;
  reason.type = "text";
  reason.maxLength = 120;
  reason.placeholder = "Reason (optional)";
  reason.setAttribute("aria-label", "Reason for score change (optional)");
  const applyBtn = el("button", "vb-btn vb-btn--primary vb-btn--small", "Apply score change");
  applyBtn.type = "submit";

  const formRow1 = el("div", "vb-scoring-form-row");
  formRow1.append(select, amount);
  const formRow2 = el("div", "vb-scoring-form-row");
  formRow2.append(reason, applyBtn);
  form.append(formRow1, formRow2);

  form.addEventListener("submit", (e) => {
    e.preventDefault(); // never a form navigation, never a buzz path
    const target = current.find((p) => p.uid === select.value);
    const delta = Number(amount.value);
    if (!target) return;
    if (!Number.isInteger(delta) || delta === 0) return;
    void guarded(target, delta, reason.value.trim() || null);
  });

  root.append(rowsBox, form);

  function rebuildRows(list: ParticipantView[]): void {
    rowsBox.replaceChildren(...list.map(buildRow));
    const prev = select.value;
    select.replaceChildren(
      ...list.map((p) => {
        const o = el("option");
        o.value = p.uid;
        o.textContent = p.name;
        return o;
      }),
    );
    if (list.some((p) => p.uid === prev)) select.value = prev;
    if (import.meta.env.DEV) {
      console.debug("[scoring] rows", list.length);
    }
  }

  return {
    root,
    setParticipants(list) {
      current = list;
      // In-place score refresh avoids rebuilding rows on every presence tick.
      if (rowsBox.childElementCount === list.length) updateScoresInPlace(list);
      else rebuildRows(list);
    },
    getCurrent: () => current,
    setBusy,
  };
}
