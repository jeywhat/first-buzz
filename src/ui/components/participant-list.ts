import type { UserId } from "../../types/common";
import type { ParticipantView } from "../../types/participant";
import { comparePlayers, STATE_LABELS } from "../../lib/player-row";
import { createGeneratedAvatar, getStableAvatarSeed } from "./generated-avatar";

export interface ParticipantListOptions {
  /** Uid of the current viewer — drives the "You" indicator. */
  uid: UserId;
  /** Hosts get the −/+ score adjustment controls in every row. */
  isHost: boolean;
  /**
   * Canonical host score adjustment (adjustPlayerScore via main.ts).
   * Resolves after the Firebase write is acknowledged.
   */
  onAdjust(target: ParticipantView, delta: number): Promise<void>;
  /**
   * Host-only: canonical score reset (resetScores via main.ts). When provided,
   * a danger footer with a confirmation modal renders at the BOTTOM of the
   * panel. Resolves after the Firebase write is acknowledged. Non-hosts never
   * see the control, whether or not this is passed.
   */
  onResetScores?(): Promise<void>;
  /**
   * Host-only: reports the reset confirmation modal opening/closing so the
   * global keyboard-buzz shortcut stays suppressed while it is open.
   */
  onModalOpenChange?(open: boolean): void;
}

interface PlayerRowRefs {
  li: HTMLLIElement;
  score: HTMLOutputElement;
  status: HTMLSpanElement | null;
  scoreWrap: HTMLElement;
  flashTimer: number | null;
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
 * Players panel — the single primary place for player presence, avatar,
 * display name, current score and (host-only) score adjustment buttons.
 *
 * Row layouts:
 *   host:     [−] [avatar name/status] [score] [+]
 *   non-host: [avatar name/status] [score] [state]
 *
 * The − button is always LEFT of the player name, the + button always RIGHT
 * of the score. Both are real native buttons inside a
 * data-disable-buzz-shortcuts wrapper, so Space/Enter on them never triggers
 * the global buzz shortcut (also excluded by the BUTTON tag guard).
 *
 * Updates are applied IN PLACE (no rebuild) so a score change never rebuilds,
 * never flickers, and only reorders when the documented ranking rule
 * (presence → score desc → join order → name, see comparePlayers) changes.
 */
export function renderParticipantList(opts: ParticipantListOptions): {
  root: HTMLElement;
  setParticipants(list: ParticipantView[]): void;
} {
  const root = el("section", "vb-players-panel");
  root.setAttribute("aria-labelledby", "players-title");

  const header = el("header", "vb-panel-header");
  const title = el("h2", "vb-section-title", "Players");
  title.id = "players-title";
  const count = el("span", "vb-player-count", "0 online");
  header.append(title, count);

  const listEl = el("ul", "vb-player-list");

  /* ---------- host-only danger footer: reset every score ---------- */
  const doReset = opts.isHost ? opts.onResetScores : undefined;

  if (doReset) {
    const footer = el("div", "vb-players-footer");
    footer.setAttribute("data-disable-buzz-shortcuts", "");

    const resetBtn = el("button", "vb-link-danger", "Reset scores");
    resetBtn.type = "button";
    footer.append(resetBtn);

    /* Confirmation modal — same copy as the former host panel. */
    const modal = el("div", "vb-modal");
    modal.hidden = true;

    const modalBox = el("div", "vb-modal__box");
    modalBox.setAttribute("role", "dialog");
    modalBox.setAttribute("aria-modal", "true");

    const modalTitle = el("h3", "vb-modal__title", "Reset all scores?");
    const modalText = el(
      "p",
      "vb-modal__text",
      "Every player's score goes back to 0. This cannot be undone.",
    );

    const modalActions = el("div", "vb-modal__actions");
    const modalCancel = el("button", "vb-btn vb-btn--ghost vb-btn--small", "Keep scores");
    modalCancel.type = "button";
    const modalConfirm = el("button", "vb-btn vb-btn--small vb-btn--danger", "Reset to 0");
    modalConfirm.type = "button";
    modalActions.append(modalCancel, modalConfirm);
    modalBox.append(modalTitle, modalText, modalActions);
    modal.append(modalBox);

    const notifyModal = (open: boolean): void => opts.onModalOpenChange?.(open);

    let resetting = false;

    resetBtn.addEventListener("click", () => {
      if (resetting) return;
      modal.hidden = false;
      notifyModal(true);
    });
    modalCancel.addEventListener("click", () => {
      modal.hidden = true;
      notifyModal(false);
    });
    modalConfirm.addEventListener("click", () => {
      modal.hidden = true;
      notifyModal(false);
      if (resetting) return;
      resetting = true;
      resetBtn.disabled = true;
      resetBtn.classList.add("vb-link-danger--pending");
      // Errors are toasted by the canonical wrapper in main.ts.
      void doReset()
        .catch(() => undefined)
        .finally(() => {
          resetting = false;
          resetBtn.disabled = false;
          resetBtn.classList.remove("vb-link-danger--pending");
        });
    });

    root.append(header, listEl, footer, modal);
  } else {
    root.append(header, listEl);
  }

  /* ---------- rows, keyed by uid (in-place updates) ---------- */
  const rows = new Map<UserId, PlayerRowRefs>();

  function makeButton(delta: number, p: ParticipantView): HTMLButtonElement {
    const plus = delta > 0;
    const btn = el(
      "button",
      `vb-score-adjust ${plus ? "vb-score-adjust--plus" : "vb-score-adjust--minus"}`,
      plus ? "+" : "−",
    );
    btn.type = "button";
    const label = plus ? `Add 1 point to ${p.name}` : `Remove 1 point from ${p.name}`;
    btn.setAttribute("aria-label", label);
    btn.title = label;
    // Belt-and-braces: keyboard-buzz also excludes BUTTON focus and any
    // ancestor carrying this attribute.
    btn.setAttribute("data-disable-buzz-shortcuts", "");
    btn.addEventListener("click", () => {
      if (btn.disabled) return; // dedup rapid clicks while pending
      btn.disabled = true;
      btn.classList.add("vb-score-adjust--pending");
      void opts
        .onAdjust(p, delta)
        .then(() => {
          // Firebase-confirmed: subtle +1/−1 feedback near the badge.
          const refs = rows.get(p.uid);
          if (refs) flashDelta(refs, delta);
        })
        .catch(() => undefined) // errors are toasted by the canonical wrapper
        .finally(() => {
          btn.disabled = false;
          btn.classList.remove("vb-score-adjust--pending");
        });
    });
    return btn;
  }

  function buildIdentity(p: ParticipantView, withStatus: boolean): HTMLElement {
    const identity = el("div", "vb-player-identity");

    const avatarWrap = el("div", "vb-player-avatar");
    avatarWrap.style.setProperty("--player-color", p.color);
    avatarWrap.append(
      createGeneratedAvatar({ seed: getStableAvatarSeed(p.uid), color: p.color, name: p.name })
        .root,
    );
    identity.append(avatarWrap);

    const text = el("div", "vb-player-text");
    const name = el("span", "vb-player-name", p.name);
    name.title = p.name; // full name survives truncation
    text.append(name);
    if (p.isHost) {
      const host = el("span", "vb-player-host", "👑");
      host.title = "Host";
      host.setAttribute("aria-label", "(host)");
      text.append(host);
    }
    if (withStatus) {
      const status = el(
        "span",
        `vb-player-status vb-player-status--${p.presenceState}`,
        p.uid === opts.uid ? "You" : STATE_LABELS[p.presenceState],
      );
      text.append(status);
      identity.append(text);
      return identity;
    }
    identity.append(text);
    return identity;
  }

  function buildRow(p: ParticipantView): PlayerRowRefs {
    const li = el("li", "vb-player-row");
    li.dataset.uid = p.uid;
    // Buzz-shortcut suppression wrapper for the whole row.
    li.setAttribute("data-disable-buzz-shortcuts", "");
    if (p.presenceState === "offline") li.classList.add("vb-player-row--offline");

    const scoreWrap = el("span", "vb-player-score-wrap");
    const score = el("output", "vb-player-score", String(p.score));
    score.dataset.role = "score";
    scoreWrap.append(score);

    let status: HTMLSpanElement | null = null;

    if (opts.isHost) {
      li.classList.add("vb-player-row--host");
      li.append(makeButton(-1, p));
      li.append(buildIdentity(p, true));
      li.append(scoreWrap);
      li.append(makeButton(1, p));
    } else {
      li.append(buildIdentity(p, false));
      li.append(scoreWrap);
      status = el(
        "span",
        `vb-player-status vb-player-status--${p.presenceState}`,
        p.uid === opts.uid ? "You" : STATE_LABELS[p.presenceState],
      );
      li.append(status);
    }

    listEl.append(li);
    return { li, score, status, scoreWrap, flashTimer: null };
  }

  /** Subtle +1 / −1 confirmation near the score badge (visual only). */
  function flashDelta(refs: PlayerRowRefs, delta: number): void {
    refs.scoreWrap.querySelector(".vb-score-flash")?.remove();
    if (refs.flashTimer !== null) window.clearTimeout(refs.flashTimer);
    const flash = el(
      "span",
      `vb-score-flash ${delta > 0 ? "vb-score-flash--plus" : "vb-score-flash--minus"}`,
      `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`,
    );
    flash.setAttribute("aria-hidden", "true");
    refs.scoreWrap.append(flash);
    refs.flashTimer = window.setTimeout(() => {
      flash.remove();
      refs.flashTimer = null;
    }, 900);
  }

  function updateRow(p: ParticipantView, refs: PlayerRowRefs): void {
    refs.score.textContent = String(p.score);
    const offline = p.presenceState === "offline";
    refs.li.classList.toggle("vb-player-row--offline", offline);
    const label = p.uid === opts.uid ? "You" : STATE_LABELS[p.presenceState];
    if (refs.status) {
      refs.status.textContent = label;
      refs.status.className = `vb-player-status vb-player-status--${p.presenceState}`;
    } else {
      // Host row: status lives inside the identity text block.
      const status = refs.li.querySelector<HTMLSpanElement>(".vb-player-status");
      if (status) {
        status.textContent = label;
        status.className = `vb-player-status vb-player-status--${p.presenceState}`;
      }
    }
  }

  return {
    root,
    setParticipants(list: ParticipantView[]) {
      const online = list.filter((p) => p.presenceState === "online").length;
      count.textContent =
        list.length === 0 ? "0 online" : `${online}/${list.length} online`;

      if (list.length === 0) {
        for (const [, refs] of rows) refs.li.remove();
        rows.clear();
        const empty = el("li", "vb-empty", "Waiting for players…");
        listEl.replaceChildren(empty);
        return;
      }
      listEl.querySelector(".vb-empty")?.remove();

      /* Membership changes: create missing rows, drop stale ones. */
      const present = new Set<UserId>();
      for (const p of list) {
        present.add(p.uid);
        const existing = rows.get(p.uid);
        if (existing) updateRow(p, existing);
        else rows.set(p.uid, buildRow(p));
      }
      for (const [uid, refs] of rows) {
        if (!present.has(uid)) {
          refs.li.remove();
          rows.delete(uid);
        }
      }

      /* In-place refresh of every row (scores, presence) … */
      for (const p of list) {
        const refs = rows.get(p.uid);
        if (refs) updateRow(p, refs);
      }

      /* … then minimal reorder per the documented ranking rule. Rows only
         move when the ranking actually changed — never on a rebuild. */
      const sorted = [...list].sort(comparePlayers);
      let expected = listEl.firstElementChild;
      for (const p of sorted) {
        const li = rows.get(p.uid)?.li;
        if (!li) continue;
        if (li !== expected) listEl.insertBefore(li, expected);
        expected = li.nextElementSibling;
      }
    },
  };
}
