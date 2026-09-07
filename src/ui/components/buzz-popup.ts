import { formatTime } from "./youtube-player";
import { RESUME_DELAY_MS } from "../../lib/buzz-rules";
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
  /** Round number of the confirmed buzz — rendered as ROUND #X · BUZZED. */
  roundNumber: number;
  winnerId: UserId;
  winnerName: string;
  winnerColor: string;
  /** True when the local viewer IS the winner. */
  isWinnerYou: boolean;
  isHost: boolean;
  videoPaused: boolean;
  /** False for late joiners / refresh / stale sessions → static render. */
  animate: boolean;
  /** Server-timestamp ms of the buzz (relative-time meta). Null-safe. */
  buzzedAt: number | null;
  /** Video position (seconds) captured at buzz time (VIDEO mm:ss meta). */
  videoTime: number | null;
  /** Current server-clock offset for the relative-time meta. */
  serverOffsetMs?: number;
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
  if (className) n.className = n.className ? `${n.className} ${className}` : className;
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * "Buzz received" popup rendered as a NORMAL SIBLING after the video shell —
 * never an overlay above the iframe on desktop. On mobile (≤759px) it is an
 * intentional notification overlay over the TOP of the video (slide-in like
 * a received message) and it disappears when the host resumes (the round
 * watcher hides it as soon as the round leaves 'buzzed'). Derived purely
 * from confirmed RTDB round state; no Firebase writes; no auto-dismiss.
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
  /** Relative-time meta state for the 1s ticker while a card is visible. */
  let metaAnchor: { buzzedAt: number; serverOffsetMs: number } | null = null;
  let metaTime: HTMLElement | null = null;
  let metaTicker: number | null = null;
  /** One-shot enable of the host resume button after the post-buzz lockout. */
  let resumeEnableTimer: number | null = null;

  function devLog(...args: unknown[]): void {
    if (import.meta.env.DEV) console.debug("[buzz-popup]", ...args);
  }

  function updateMetaTime(): void {
    if (!metaAnchor || !metaTime) return;
    const elapsedSec = Math.max(
      0,
      Math.round((Date.now() + metaAnchor.serverOffsetMs - metaAnchor.buzzedAt) / 1000),
    );
    metaTime.textContent = elapsedSec < 2 ? "just now" : `${elapsedSec}s ago`;
  }

  function startMetaTicker(): void {
    if (metaTicker !== null) return;
    metaTicker = window.setInterval(updateMetaTime, 1000);
  }

  function stopMetaTicker(): void {
    if (metaTicker !== null) {
      window.clearInterval(metaTicker);
      metaTicker = null;
    }
    metaAnchor = null;
    metaTime = null;
  }

  /* DEV-only structural guards (historical overlay bug regression). */
  function runDevChecks(): void {
    if (!import.meta.env.DEV || !card) return;
    if (card.closest(".vb-video-frame") || card.closest(".vb-video-shell")) {
      console.warn("[buzz-popup] WARN: popup rendered inside the video shell!");
    }
    // Desktop invariant: normal-flow sibling (never absolute/fixed over the
    // video). On mobile the popup intentionally overlays the video top as a
    // received-message notification, so this check is desktop-width-gated.
    const pos = getComputedStyle(card).position;
    if (window.innerWidth >= 1100 && (pos === "absolute" || pos === "fixed")) {
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
    stopMetaTicker();
    if (resumeEnableTimer !== null) {
      window.clearTimeout(resumeEnableTimer);
      resumeEnableTimer = null;
    }
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
    stopMetaTicker();
    card = el("div", "vb-buzz-popup");
    card.dataset.eventKey = info.buzzEventKey;
    card.dataset.state = "buzzed";
    card.style.setProperty("--winner-color", info.winnerColor);
    if (info.isWinnerYou) card.classList.add("vb-buzz-popup--you");
    if (animate) card.classList.add("vb-buzz-popup--enter");

    /* ---- header: round badge + playback badge (ALL round metadata lives
       here — the Buzzer zone carries none of it) ---- */
    const header = el("div", "vb-buzz-popup__header");
    header.setAttribute("aria-hidden", "true"); // headline below carries the info
    header.append(el("span", "vb-round-badge", `ROUND #${info.roundNumber} · BUZZED`));
    if (info.videoPaused) header.append(el("span", "vb-paused-badge", "VIDEO PAUSED"));

    /* ---- winner row ---- */

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
    const subline = el("p", "vb-buzz-popup__subline", info.isWinnerYou ? "You buzzed first!" : "");
    textWrap.append(headline, subline);

    // Winner row identity is fully carried by the name; the avatar is décor.
    const winnerRow = el("div", "vb-buzz-popup__winner");
    winnerRow.append(avatar, textWrap);

    // Relative time + video position meta (video-position is stable text;
    // relative time refreshes once per second while the popup is visible).
    const meta = el("div", "vb-buzz-popup__meta");
    meta.setAttribute("aria-hidden", "true");
    if (info.buzzedAt != null) {
      metaTime = el("span", "vb-buzz-popup__meta-time");
      metaAnchor = {
        buzzedAt: info.buzzedAt,
        serverOffsetMs: info.serverOffsetMs ?? 0,
      };
      updateMetaTime();
      startMetaTicker();
      meta.append(metaTime);
    }
    if (info.videoTime != null) {
      meta.append(el("span", "vb-buzz-popup__meta-video", `VIDEO ${formatTime(info.videoTime)}`));
    }

    const winnerWrap = el("div", "vb-buzz-popup__body");
    winnerWrap.append(winnerRow);
    if (meta.childElementCount > 0) winnerWrap.append(meta);

    card.append(header, winnerWrap);

    if (info.isHost && actions) {
      const bar = el("div", "vb-buzz-popup__actions");
      bar.setAttribute("data-disable-buzz-shortcuts", "");
      // ONE button: resume + reopen the round. Popup closes itself when the
      // authoritative round flips to "cooldown"/"open" (watchRound → hide).
      const resume = el("button", "vb-btn vb-btn--small vb-btn--success", "▶ Resume video");
      resume.type = "button";
      resume.setAttribute(
        "aria-label",
        "Resume video and open the next buzz round",
      );
      // Post-buzz lockout: same RESUME_DELAY_MS rule as the buzzer panel —
      // the host cannot resume for one second after the buzz lands, so the
      // room gets a beat to see WHO buzzed. Server-anchored comparison.
      const startedAt = info.buzzedAt;
      const delayRemaining =
        typeof startedAt === "number" && Number.isFinite(startedAt)
          ? Math.max(
              0,
              startedAt +
                RESUME_DELAY_MS -
                (Date.now() + (info.serverOffsetMs ?? 0)),
            )
          : 0;
      if (delayRemaining > 0) {
        resume.disabled = true;
        resumeEnableTimer = window.setTimeout(() => {
          resumeEnableTimer = null;
          resume.disabled = false;
        }, delayRemaining + 25);
      }
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
