import type { QueueItem } from "../../types/queue";
import { resolveQueueView, type QueueView, type VideoQueueSnapshot } from "../../types/queue";

export interface VideoQueuePanelHandles {
  root: HTMLElement;
  /** Feed the panel with the authoritative queue snapshot. */
  setSnapshot(snap: VideoQueueSnapshot, legacyActiveVideoId: string | null): void;
  dispose(): void;
}

export interface VideoQueuePanelOptions {
  addItem(rawUrl: string, opts: { allowDuplicate: boolean }): Promise<void>;
  moveItem(itemId: string, dir: "up" | "down"): Promise<void>;
  removeItem(itemId: string): Promise<void>;
  clearQueue(): Promise<number>;
  launch(itemId: string, autoplay: boolean): void;
  /** Computes and launches the next queued item (or first when none active). */
  playNext(): void;
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
 * Host-only Video Queue panel. Collapsible; the list scrolls internally so a
 * long queue never pushes the sticky BUZZ button out of the viewport.
 */
export function createVideoQueuePanel(
  opts: VideoQueuePanelOptions,
): VideoQueuePanelHandles {
  const root = el("section", "vb-vq-panel");
  root.setAttribute("aria-label", "Video queue");

  /* -------- header -------- */
  const details = el("details", "vb-vq-details");
  const summary = el("summary", "vb-section-title");
  const countBadge = el("span", "vb-vq-count", "(0)");
  summary.textContent = "Video Queue ";
  summary.append(countBadge);
  details.append(summary);

  /* -------- add form -------- */
  const formRow = el("div", "vb-vq-add-row");
  const urlInput = el("input", "vb-input vb-vq-url");
  urlInput.type = "text";
  urlInput.spellcheck = false;
  urlInput.placeholder = "Paste a YouTube URL…";
  urlInput.setAttribute("data-disable-buzz-shortcuts", "");
  const addBtn = el("button", "vb-btn vb-btn--primary vb-btn--small", "Add");
  addBtn.type = "button";
  formRow.append(urlInput, addBtn);

  const formError = el("p", "vb-field-error");
  const confirmNote = el("p", "vb-vq-confirm-note");

  /* -------- list -------- */
  const listBox = el("div", "vb-vq-list");
  const listEl = el("ul", "vb-vq-items");
  listBox.append(listEl);

  /* -------- footer actions -------- */
  const footerRow = el("div", "vb-vq-footer");
  const nextBtn = el("button", "vb-btn vb-btn--ghost vb-btn--small", "Play next");
  nextBtn.type = "button";
  const clearBtn = el("button", "vb-btn vb-btn--ghost vb-btn--small vb-link-danger", "Clear queue");
  clearBtn.type = "button";
  footerRow.append(nextBtn, clearBtn);

  /* -------- aria-live -------- */
  const live = el("div", "vb-sr-only");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  function announce(m: string): void {
    live.textContent = m;
  }

  let duplicatePending = false;

  async function submitAdd(allowDuplicate: boolean): Promise<void> {
    const raw = urlInput.value;
    if (!raw.trim()) {
      formError.textContent = "Enter a YouTube URL to add.";
      return;
    }
    try {
      await opts.addItem(raw, { allowDuplicate });
      formError.textContent = "";
      confirmNote.textContent = "";
      duplicatePending = false;
      urlInput.value = "";
      announce("Queued item added.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "queue:duplicate" && !allowDuplicate) {
        duplicatePending = true;
        formError.textContent = "";
        confirmNote.textContent =
          "This video is already queued. Press Add again to queue it anyway.";
      } else if (msg === "queue:invalid-video-id" || msg === "queue:empty-url") {
        formError.textContent = "Enter a valid YouTube URL.";
        confirmNote.textContent = "";
        duplicatePending = false;
      } else {
        formError.textContent = "Could not add to queue.";
        if (import.meta.env.DEV) console.warn("[vq] add failed", err);
      }
    }
  }

  addBtn.addEventListener("click", () => {
    void submitAdd(duplicatePending);
  });
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submitAdd(duplicatePending);
    }
  });

  function bindRowActions(row: HTMLElement, item: QueueItem, view: QueueView): void {
    const launchBtn = el("button", "vb-btn vb-btn--small vb-btn--success", "Launch");
    launchBtn.type = "button";
    launchBtn.disabled = view.active?.id === item.id;
    launchBtn.addEventListener("click", () => opts.launch(item.id, false));

    const launchPlay = el("button", "vb-btn vb-btn--small", "Launch & play ▶");
    launchPlay.type = "button";
    launchPlay.classList.add("vb-btn--ghost");
    launchPlay.disabled = view.active?.id === item.id;
    launchPlay.addEventListener("click", () => opts.launch(item.id, true));

    const upBtn = el("button", "vb-btn vb-btn--ghost vb-btn--small", "↑ Move up");
    upBtn.type = "button";
    upBtn.setAttribute("aria-label", `Move ${item.videoId} up`);
    upBtn.addEventListener("click", () => void opts.moveItem(item.id, "up"));

    const downBtn = el("button", "vb-btn vb-btn--ghost vb-btn--small", "↓ Move down");
    downBtn.type = "button";
    downBtn.setAttribute("aria-label", `Move ${item.videoId} down`);
    downBtn.addEventListener("click", () => void opts.moveItem(item.id, "down"));

    const remBtn = el("button", "vb-btn vb-btn--ghost vb-btn--small vb-link-danger", "Remove");
    remBtn.type = "button";
    remBtn.disabled = view.active?.id === item.id;
    remBtn.title = view.active?.id === item.id ? "Active item — select another video first" : "";
    remBtn.addEventListener("click", () => void opts.removeItem(item.id));

    row.append(launchBtn, launchPlay, upBtn, downBtn, remBtn);
  }

  function render(view: QueueView): void {
    countBadge.textContent = `(${view.items.length})`;
    listEl.replaceChildren();

    if (view.items.length === 0) {
      const empty = el("li", "vb-empty", "Queue empty — paste a YouTube link above.");
      listEl.append(empty);
    }

    for (const item of view.items) {
      const li = el("li", "vb-vq-item");
      const isActive = view.active?.id === item.id;
      if (isActive) li.classList.add("vb-vq-item--active");

      const head = el("div", "vb-vq-item-head");
      const badge = isActive ? "Active" : view.activeIsLegacy && item.position < 0 ? "Legacy" : "Ready";
      const b = el("span", "vb-vq-badge");
      b.textContent = badge;
      if (isActive) b.classList.add("vb-vq-badge--active");

      const title = el(
        "span",
        "vb-vq-title",
        item.title ?? `Video ${item.videoId}`,
      );
      const idTag = el("span", "vb-vq-id", `${item.videoId}`);
      head.append(b, title, idTag);

      li.append(head);
      bindRowActions(li, item, view);
      listEl.append(li);
    }
  }

  nextBtn.addEventListener("click", () => {
    announce("Launching next queued video…");
    opts.playNext();
  });

  clearBtn.addEventListener("click", () => {
    if (!window.confirm("Remove every non-active queued video?")) return;
    void opts.clearQueue().then((n) => {
      announce(`Removed ${n} queued videos.`);
    }).catch(() => announce("Could not clear the queue."));
  });

  details.append(formRow, formError, confirmNote, listBox, footerRow, live);
  root.append(details);

  return {
    root,
    setSnapshot(snap, legacyActiveVideoId) {
      const view = resolveQueueView(snap, legacyActiveVideoId);
      render(view);
      if (import.meta.env.DEV) {
        console.debug("[vq]", `rev=${view.revision}`, `active=${view.active?.id ?? "-"}`);
      }
    },
    dispose() {},
  };
}
