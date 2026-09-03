import type { UserId } from "../../types/common";

export interface BuzzPopupActions {
  /**
   * Single popup action: resumes playback AND opens the next buzz round
   * (which clears the winner and closes the popup via the round watcher).
   * Same canonical handler as the host panel — no second code path.
   */
  onResumeAndNext(): void;
}

export interface BuzzPopupInfo {
  buzzEventKey: string;
  winnerId: UserId;
  winnerName: string;
  winnerColor: string;
  /** True when the local viewer IS the winner. */
  isWinnerYou: boolean;
  isHost: boolean;
  videoPaused: boolean;
  /** False for late joiners / refresh / stale sessions → static render. */
  animate: boolean;
}

export interface BuzzPopupHandles {
  /** Always-mounted region (aria-live polite). Rendered content sits inside. */
  root: HTMLElement;
  setActions(actions: BuzzPopupActions): void;
  show(info: BuzzPopupInfo): void;
  hide(cause: string): void;
  /** Neutral local "Buzz sent…" while the viewer's own transaction is in flight. */
  setPending(pending: boolean): void;
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
 * "Buzz received" popup rendered as a NORMAL SIBLING after the video shell —
 * never an overlay above the iframe. Derived purely from confirmed RTDB round
 * state; no Firebase writes; no timers; no auto-dismiss.
 */
export function createBuzzPopup(): BuzzPopupHandles {
  const root = el("div", "vb-buzz-popup-region");
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-atomic", "true");

  let actions: BuzzPopupActions | null = null;
  let card: HTMLElement | null = null;
  let pendingCard: HTMLElement | null = null;
  /** One-shot entrance animation per confirmed event key. */
  const animatedKeys = new Set<string>();

  function devLog(...args: unknown[]): void {
    if (import.meta.env.DEV) console.debug("[buzz-popup]", ...args);
  }

  /* DEV-only structural guards (historical overlay bug regression). */
  function runDevChecks(): void {
    if (!import.meta.env.DEV || !card) return;
    if (card.closest(".vb-video-frame") || card.closest(".vb-video-shell")) {
      console.warn("[buzz-popup] WARN: popup rendered inside the video shell!");
    }
    const pos = getComputedStyle(card).position;
    if (pos === "absolute" || pos === "fixed") {
      console.warn(`[buzz-popup] WARN: popup position is ${pos}`);
    }
    const stale = document.querySelector(".vb-video-error");
    if (stale && getComputedStyle(stale).display !== "none") {
      console.warn("[buzz-popup] WARN: .vb-video-error present with non-none display");
    }
  }

  function buildPendingCard(): void {
    pendingCard = el("div", "vb-buzz-popup vb-buzz-popup--pending");
    const label = el("span", "vb-buzz-popup__label", "Buzz sent…");
    pendingCard.append(label);
    root.replaceChildren(pendingCard);
  }

  function hide(cause: string): void {
    if (!card && !pendingCard) return;
    card = null;
    pendingCard = null;
    root.replaceChildren();
    devLog("hidden:", cause);
  }

  function show(info: BuzzPopupInfo): void {
    pendingCard = null;
    const firstRenderForKey = !animatedKeys.has(info.buzzEventKey);
    // Animation exactly once per confirmed key; content still re-renders
    // (identity/role changes) without replaying the entrance.
    const animate = info.animate && firstRenderForKey;
    animatedKeys.add(info.buzzEventKey);

    const wasSameKey = card?.dataset.eventKey === info.buzzEventKey;
    card?.remove();
    card = el("div", "vb-buzz-popup");
    card.dataset.eventKey = info.buzzEventKey;
    card.style.setProperty("--winner-color", info.winnerColor);
    if (info.isWinnerYou) card.classList.add("vb-buzz-popup--you");
    if (animate) card.classList.add("vb-buzz-popup--enter");

    // Avatar initials — text always carries the identity (color is accent).
    const avatar = el("span", "vb-buzz-popup__avatar");
    avatar.style.setProperty("--winner-color", info.winnerColor);
    const initials = info.winnerName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");
    avatar.textContent = initials || "?";
    avatar.setAttribute("aria-hidden", "true");

    const textWrap = el("div", "vb-buzz-popup__text");
    const headline = el("p", "vb-buzz-popup__headline");
    const name = el("strong", "vb-buzz-popup__name", info.winnerName);
    headline.append(name, document.createTextNode(" buzzed first"));
    const subline = el(
      "p",
      "vb-buzz-popup__subline",
      info.isWinnerYou ? "You buzzed first!" : info.videoPaused ? "Video paused" : "",
    );
    textWrap.append(headline, subline);

    card.append(avatar, textWrap);

    if (info.isHost && actions) {
      const bar = el("div", "vb-buzz-popup__actions");
      bar.setAttribute("data-disable-buzz-shortcuts", "");
      // ONE button: resume + reopen the round. Popup closes itself when the
      // authoritative round flips to "open" (watchRound → hide).
      const resume = el("button", "vb-btn vb-btn--small vb-btn--success", "▶ Resume video");
      resume.type = "button";
      resume.setAttribute(
        "aria-label",
        "Resume video and open the next buzz round",
      );
      resume.addEventListener("click", () => actions?.onResumeAndNext());
      bar.append(resume);
      card.append(bar);
    }

    root.replaceChildren(card);
    runDevChecks();
    devLog(
      wasSameKey ? "re-rendered (no animation)" : "shown:",
      info.buzzEventKey,
      animate ? "entrance played" : "entrance skipped (static)",
    );
  }

  return {
    root,
    setActions(a) {
      actions = a;
    },
    show,
    hide,
    setPending(pending) {
      if (pending) {
        if (!pendingCard) {
          buildPendingCard();
          devLog("pending shown (local, neutral)");
        }
        return;
      }
      if (pendingCard && !card) {
        // Transaction ended without a confirmed win → back to empty region.
        hide("pending cleared");
      }
    },
  };
}
