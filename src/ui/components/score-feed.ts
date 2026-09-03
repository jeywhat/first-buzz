import type { ScoreEvent } from "../../lib/scoring";

export interface ScoreFeedHandles {
  root: HTMLElement;
  /** Newest-first list (already capped to the most recent 50 upstream). */
  setEvents(events: ScoreEvent[]): void;
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

/**
 * Read-only, capped score-change feed. Visible to EVERYONE (players included)
 * — it renders the audit log only; the durable players/{uid}/score remains the
 * source of truth and no mutation handler exists in this component.
 */
export function createScoreFeed(): ScoreFeedHandles {
  const root = el("section", "vb-score-feed");
  root.setAttribute("aria-label", "Recent score changes");

  const title = el("h2", "vb-section-title", "Score activity");
  root.append(title);

  const list = el("ul", "vb-score-feed-list");
  root.append(list);

  return {
    root,
    setEvents(events: ScoreEvent[]) {
      list.replaceChildren();
      if (events.length === 0) {
        const empty = el("li", "vb-empty", "No score changes yet.");
        list.append(empty);
        return;
      }
      for (const ev of events) {
        const li = el("li", "vb-score-feed-item");
        const deltaCls = ev.delta >= 0 ? "vb-score-feed-delta--plus" : "vb-score-feed-delta--minus";
        const delta = el(
          "span",
          `vb-score-feed-delta ${deltaCls}`,
          `${ev.delta >= 0 ? "+" : "−"}${Math.abs(ev.delta)}`,
        );
        const label = el(
          "span",
          "vb-score-feed-label",
          `${ev.targetDisplayName} · ${ev.scoreBefore}→${ev.scoreAfter}`,
        );
        label.title = ev.reason ? `Reason: ${ev.reason}` : "";
        li.append(delta, label);
        list.append(li);
      }
    },
  };
}
