import {
  buildPlayerQueueSummary,
  type QueueItem,
  type QueueView,
} from "../../types/queue";

export interface PlayerQueueHandles {
  root: HTMLElement;
  setView(view: QueueView): void;
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
 * Read-only queue summary for players: active item + next few + remaining.
 * No mutation handlers exist in this component by construction.
 */
export function createPlayerQueue(): PlayerQueueHandles {
  const root = el("section", "vb-pq");
  root.setAttribute("aria-label", "Upcoming videos");

  const titleEl = el("h2", "vb-section-title", "Video queue");
  const list = el("ul", "vb-pq-list");

  root.append(titleEl, list);

  function row(item: QueueItem, kind: "active" | "next"): HTMLLIElement {
    const li = el("li", `vb-pq-item vb-pq-item--${kind}`);
    const badge = el("span", "vb-vq-badge");
    badge.textContent = kind === "active" ? "Now" : "Next";
    const label = el("span", "vb-vq-title", item.title ?? `Video ${item.videoId}`);
    li.append(badge, label);
    return li;
  }

  return {
    root,
    setView(view: QueueView) {
      list.replaceChildren();
      const s = buildPlayerQueueSummary(view, 4);
      let total = 0;

      if (s.active) {
        list.append(row(s.active, "active"));
        total++;
      }
      for (const it of s.upcoming) {
        list.append(row(it, "next"));
        total++;
      }
      if (s.remainingAfterShown > 0) {
        const more = el("li", "vb-pq-item vb-pq-item--more", `…and ${s.remainingAfterShown} more`);
        list.append(more);
        total++;
      }
      if (total === 0) {
        const empty = el("li", "vb-empty", "Queue empty — waiting for the host.");
        list.append(empty);
      }
    },
  };
}
