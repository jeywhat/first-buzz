import type { UserId } from "../../types/common";
import {
  getArenaPlayers,
  type ArenaViewModel,
  type StagePlayer,
} from "../../lib/stage-selectors";
import type { ParticipantView, RoundData } from "../../types";
import { createGeneratedAvatar, getStableAvatarSeed } from "./generated-avatar";

export interface PlayerArenaHandles {
  root: HTMLElement;
  /** Mounts the ONE canonical buzz panel in the arena center. */
  mountBuzzPanel(buzzRoot: HTMLElement): void;
  setRoomData(players: ParticipantView[], round: RoundData | null, currentUserId: UserId): void;
  dispose(): void;
}

export interface PlayerArenaOptions {
  isHost: boolean;
  /** Canonical host score adjustment (same service as the scoring panel). */
  onAdjust(uid: UserId, delta: number): Promise<void>;
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
 * Circular "Player Arena": connected players on an orbit ring around the
 * ONE canonical buzz button. Pure visual layer over existing room data —
 * no Firebase writes. Positions are stable across score changes (ordering
 * never depends on score).
 */
export function createPlayerArena(opts: PlayerArenaOptions): PlayerArenaHandles {
  const root = el("section", "vb-player-arena");
  root.setAttribute("aria-labelledby", "vb-arena-title");

  /* ---------- header ---------- */
  const header = el("header", "vb-arena-header");
  const headerLeft = el("div", "vb-arena-header-left");
  const liveDot = el("span", "vb-arena-live-dot");
  liveDot.setAttribute("aria-hidden", "true");
  const title = el("h2", "vb-arena-title", "Player Arena");
  title.id = "vb-arena-title";
  headerLeft.append(liveDot, title);

  const headerRight = el("div", "vb-arena-header-right");
  const hostBadge = el("span", "vb-arena-badge vb-arena-badge--host");
  hostBadge.textContent = "👑 HOST";
  const onlineBadge = el("span", "vb-arena-badge vb-arena-badge--online", "0 ONLINE");
  headerRight.append(hostBadge, onlineBadge);

  header.append(headerLeft, headerRight);
  root.append(header);

  /* ---------- orbit stage ---------- */
  const stage = el("div", "vb-arena-stage");

  const rings = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  rings.setAttribute("class", "vb-arena-rings");
  rings.setAttribute("viewBox", "0 0 100 100");
  rings.setAttribute("aria-hidden", "true");
  const mk = (r: number, stroke: string, dash: string, w: number): SVGElement => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", "50");
    c.setAttribute("cy", "50");
    c.setAttribute("r", String(r));
    c.setAttribute("stroke", stroke);
    c.setAttribute("stroke-dasharray", dash);
    c.setAttribute("stroke-width", String(w));
    c.setAttribute("fill", "none");
    return c;
  };
  rings.append(mk(34, "#94a3b8", "3 3", 0.8), mk(22, "#cbd5e1", "2 2", 0.6));
  // Warm central dish behind the buzzer (reference signature).
  const dish = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dish.setAttribute("cx", "50");
  dish.setAttribute("cy", "50");
  dish.setAttribute("r", "22");
  dish.setAttribute("fill", "#fef2f2");
  dish.setAttribute("stroke", "#fecaca");
  dish.setAttribute("stroke-width", "0.8");
  rings.append(dish);
  stage.append(rings);

  // Canonical buzz button lives in the center (mounted by main.ts).
  const center = el("div", "vb-arena-center");
  stage.append(center);

  const layer = el("div", "vb-arena-players");
  stage.append(layer);

  const overflowChip = el("span", "vb-arena-overflow");
  overflowChip.hidden = true;
  stage.append(overflowChip);

  root.append(stage);

  /* ---------- host bar (post-buzz canonical actions live in host panel;
     this bar only hosts the host-only hint) ---------- */
  const hostBar = el("div", "vb-arena-hostbar");
  hostBar.setAttribute("data-disable-buzz-shortcuts", "");
  root.append(hostBar);

  /* ---------- accessible fallback ---------- */
  const fallback = el("p", "vb-arena-fallback");
  fallback.textContent = "Full player list and scoring available below.";
  root.append(fallback);

  /* ---------- podium management ---------- */
  const podiums = new Map<UserId, HTMLElement>();
  const pendingAdjust = new Set<UserId>();
  let lastVm: ArenaViewModel | null = null;

  function buildPodium(p: StagePlayer): HTMLElement {
    const node = el("div", "vb-arena-player");
    node.classList.add(`vb-arena-player--t${p.sortTier}`);

    const badge = el("span", "vb-arena-player-you", "YOU");
    badge.setAttribute("aria-hidden", "true");

    const avatarWrap = el("div", "vb-arena-avatar");
    avatarWrap.style.setProperty("--player-color", p.color);
    if (p.isWinner) avatarWrap.classList.add("vb-arena-avatar--winner");
    if (p.isCurrentUser) avatarWrap.classList.add("vb-arena-avatar--you");
    avatarWrap.append(
      createGeneratedAvatar({ seed: getStableAvatarSeed(p.avatarSeed), color: p.color, name: p.name }).root,
    );
    const dot = el("span", "vb-arena-dot");
    dot.classList.add(`vb-arena-dot--${p.presenceState}`);
    dot.setAttribute("aria-hidden", "true");
    avatarWrap.append(dot);
    if (p.isCurrentUser) avatarWrap.append(badge);

    const plate = el("div", "vb-arena-plate");
    const nameRow = el("div", "vb-arena-plate-name");
    const nameEl = el("span", "vb-arena-plate-name-text", p.name);
    nameRow.append(nameEl);
    if (p.isHost) {
      const crown = el("span", "vb-arena-plate-crown");
      crown.textContent = "👑";
      crown.title = "Host";
      crown.setAttribute("aria-label", "(host)");
      nameRow.append(crown);
    }

    const scoreRow = el("div", "vb-arena-plate-score");
    const minus = el("button", "vb-arena-score-btn vb-arena-score-btn--minus", "−");
    minus.type = "button";
    minus.setAttribute("aria-label", `Remove 1 point from ${p.name}`);
    const score = el("span", "vb-arena-plate-score-value", String(p.score));
    score.dataset.role = "score";
    const plus = el("button", "vb-arena-score-btn vb-arena-score-btn--plus", "+");
    plus.type = "button";
    plus.setAttribute("aria-label", `Add 1 point to ${p.name}`);

    scoreRow.append(minus, score, plus);
    plate.append(nameRow, scoreRow);

    if (p.isWinner) {
      const win = el("span", "vb-arena-player-win", "⚡ FIRST!");
      win.setAttribute("aria-hidden", "true");
      node.append(win);
    }

    node.append(avatarWrap, plate);

    // Host-only scoring through the canonical service; players never see these.
    if (opts.isHost) {
      const adjust = (delta: number): void => {
        if (pendingAdjust.has(p.uid)) return; // dedup while a write is pending
        pendingAdjust.add(p.uid);
        void opts
          .onAdjust(p.uid, delta)
          .catch(() => {})
          .finally(() => pendingAdjust.delete(p.uid));
      };
      minus.addEventListener("click", () => adjust(-1));
      plus.addEventListener("click", () => adjust(1));
    } else {
      minus.remove();
      plus.remove();
      scoreRow.classList.add("vb-arena-plate-score--readonly");
    }

    return node;
  }

  function positionPodiums(vm: ArenaViewModel): void {
    const n = vm.visible.length;
    const uids = new Set(vm.visible.map((p) => p.uid));
    for (const [uid, node] of podiums) {
      if (!uids.has(uid)) {
        node.remove();
        podiums.delete(uid);
      }
    }
    vm.visible.forEach((p, i) => {
      let node = podiums.get(p.uid);
      if (!node) {
        node = buildPodium(p);
        podiums.set(p.uid, node);
        layer.append(node);
      }
      // Stable circular placement: even angular distribution starting at top.
      // Radius comes from the CSS var (--vb-arena-radius) so media queries
      // can tighten it on small screens without JS knowing about viewports.
      const angle = -90 + (360 / Math.max(n, 1)) * i;
      const rad = (angle * Math.PI) / 180;
      node.style.setProperty("--player-angle", `${angle}deg`);
      node.style.setProperty(
        "--player-x",
        `calc(50% + var(--vb-arena-radius, 34%) * ${Math.cos(rad).toFixed(4)})`,
      );
      node.style.setProperty(
        "--player-y",
        `calc(50% + var(--vb-arena-radius, 34%) * ${Math.sin(rad).toFixed(4)})`,
      );
    });
    overflowChip.hidden = vm.overflowCount === 0;
    overflowChip.textContent = vm.overflowCount > 0 ? `+${vm.overflowCount} more` : "";
  }

  function updateScores(vm: ArenaViewModel): void {
    for (const p of vm.visible) {
      const node = podiums.get(p.uid);
      if (!node) continue;
      const scoreEl = node.querySelector<HTMLElement>('[data-role="score"]');
      if (scoreEl && scoreEl.textContent !== String(p.score)) {
        scoreEl.textContent = String(p.score);
        node.classList.remove("vb-arena-score-pop");
        void node.offsetWidth;
        node.classList.add("vb-arena-score-pop");
      }
      node.classList.toggle("vb-arena-player--offline", p.presenceState === "offline");
      node.classList.toggle("vb-arena-player--reconnecting", p.presenceState === "reconnecting" || p.presenceState === "connecting");
      node.classList.toggle("vb-arena-player--winner", p.isWinner);
      node.classList.toggle("vb-arena-player--locked", vm.roundLocked && !p.isWinner);
    }
  }

  return {
    root,
    mountBuzzPanel(buzzRoot) {
      center.append(buzzRoot);
    },
    setRoomData(players, round, currentUserId) {
      const vm = getArenaPlayers(players, round, currentUserId);
      lastVm = vm;
      onlineBadge.textContent = `${vm.onlineCount} ONLINE`;
      hostBadge.hidden = !players.some((p) => p.isHost);
      positionPodiums(vm);
      updateScores(vm);
      if (import.meta.env.DEV) {
        console.debug(
          "[arena]",
          `total=${vm.total} online=${vm.onlineCount} overflow=${vm.overflowCount}`,
        );
      }
    },
    dispose() {
      podiums.clear();
      void lastVm;
    },
  };
}
