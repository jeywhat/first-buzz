import type { UserId } from "../../types/common";
import {
  getArenaPlayers,
  type ArenaViewModel,
  type StagePlayer,
} from "../../lib/stage-selectors";
import {
  calculateArenaGeometry,
} from "../../lib/arena-geometry";
import type { ParticipantView, RoundData } from "../../types";
import { createGeneratedAvatar, getStableAvatarSeed } from "./generated-avatar";

export interface PlayerArenaHandles {
  root: HTMLElement;
  /** Mounts the ONE canonical buzz panel: core → center, status → top, feedback → bottom. */
  mountBuzzPanel(core: HTMLElement, status: HTMLElement, feedback: HTMLElement): void;
  setRoomData(players: ParticipantView[], round: RoundData | null, currentUserId: UserId): void;
  dispose(): void;
}

export interface PlayerArenaOptions {
  isHost: boolean;
  /** Canonical host score adjustment (same service as the scoring panel). */
  onAdjust(uid: UserId, delta: number): Promise<void>;
}

type SizeClass = "cozy" | "compact";
type ControlsVariant = "inline" | "anchored" | "plain";

const SVG_NS = "http://www.w3.org/2000/svg";

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
 * Circular "Player Arena" with reserved zones:
 *   top status    → round pill + VIDEO PAUSED + winner summary
 *   center        → the ONE canonical BUZZ button (nothing else)
 *   bottom feedback → "You buzzed first!" + keyboard hint
 *   player ring   → podium stations placed by calculateArenaGeometry
 * Station size ladder (cozy-inline → compact-inline → compact-anchored)
 * maximizes visible podiums; the pure helper guarantees zero overlap.
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

  /* ---------- stage with dedicated zones ---------- */
  const stage = el("div", "vb-arena-stage");
  stage.dataset.mode = "ring";
  stage.dataset.size = "cozy";
  stage.dataset.controls = "inline";

  const rings = document.createElementNS(SVG_NS, "svg");
  rings.setAttribute("class", "vb-arena-rings");
  rings.setAttribute("viewBox", "0 0 100 100");
  rings.setAttribute("aria-hidden", "true");
  const circle = (r: number, attrs: Record<string, string>): SVGElement => {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", "50");
    c.setAttribute("cy", "50");
    c.setAttribute("r", String(r));
    for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, v);
    return c;
  };
  rings.append(
    circle(40, { stroke: "#94a3b8", "stroke-dasharray": "3 3", "stroke-width": "0.8", fill: "none" }),
    circle(28, { stroke: "#cbd5e1", "stroke-dasharray": "2 2", "stroke-width": "0.6", fill: "none" }),
    circle(17, { fill: "#fef2f2", stroke: "#fecaca", "stroke-width": "0.6" }),
  );
  stage.append(rings);

  // Top status zone — round pill + VIDEO PAUSED + winner summary (reserved).
  const statusZone = el("div", "vb-arena-top-status");
  statusZone.setAttribute("aria-live", "polite");
  stage.append(statusZone);

  // Player ring — stations only (geometry keeps them out of the zones).
  const ring = el("div", "vb-arena-player-ring");
  stage.append(ring);

  // Center zone — ONLY the canonical button.
  const centerZone = el("div", "vb-arena-center");
  stage.append(centerZone);

  // Bottom feedback zone — status line + keyboard hint (reserved).
  const feedbackZone = el("div", "vb-arena-bottom-feedback");
  feedbackZone.setAttribute("aria-live", "polite");
  stage.append(feedbackZone);

  const overflowChip = el("span", "vb-arena-overflow");
  overflowChip.hidden = true;
  stage.append(overflowChip);

  root.append(stage);

  const footer = el("footer", "vb-arena-footer");
  footer.textContent = "Full player list and scoring available below.";
  root.append(footer);

  /* ---------- podium management ---------- */
  const podiums = new Map<UserId, HTMLElement>();
  const pendingAdjust = new Set<UserId>();
  let currentBuild: string | null = null;
  let openPopoverUid: UserId | null = null;

  function closePopover(): void {
    if (openPopoverUid === null) return;
    podiums.get(openPopoverUid)?.querySelector(".vb-arena-score-popover")?.setAttribute("hidden", "");
    const trigger = podiums.get(openPopoverUid)?.querySelector<HTMLButtonElement>(".vb-arena-score-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    openPopoverUid = null;
  }

  function setStationPending(uid: UserId, pending: boolean): void {
    const node = podiums.get(uid);
    if (!node) return;
    node.classList.toggle("vb-arena-station--pending", pending);
    for (const b of Array.from(node.querySelectorAll<HTMLButtonElement>(".vb-arena-score-btn"))) {
      b.disabled = pending ? true : opts.isHost && b.dataset.plainSkip === "1" ? b.disabled : pending;
    }
    const row = node.querySelector<HTMLElement>(".vb-arena-score-row");
    if (row) row.setAttribute("aria-busy", String(pending));
  }

  function adjust(uid: UserId, delta: number): void {
    if (pendingAdjust.has(uid)) return; // dedup per player while pending
    pendingAdjust.add(uid);
    setStationPending(uid, true);
    void opts
      .onAdjust(uid, delta)
      .catch(() => {})
      .finally(() => {
        pendingAdjust.delete(uid);
        setStationPending(uid, false);
      });
  }

  function buildPodium(p: StagePlayer, controls: ControlsVariant): HTMLElement {
    const node = el("div", "vb-arena-player");
    node.classList.add(`vb-arena-player--t${p.sortTier}`);
    node.dataset.uid = p.uid;
    node.dataset.controls = controls;

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
    nameRow.append(el("span", "vb-arena-plate-name-text", p.name));
    if (p.isHost) {
      const crown = el("span", "vb-arena-plate-crown");
      crown.textContent = "👑";
      crown.title = "Host";
      crown.setAttribute("aria-label", "(host)");
      nameRow.append(crown);
    }
    plate.append(nameRow);

    const score = el("span", "vb-arena-plate-score-value", String(p.score));
    score.dataset.role = "score";

    if (controls !== "plain") {
      // Scoring wrapper — suppresses global Space/Enter buzz shortcuts.
      const row = el("div", "vb-arena-score-row");
      row.setAttribute("data-disable-buzz-shortcuts", "");

      const mkBtn = (delta: number, glyph: string, label: string): HTMLButtonElement => {
        const b = el("button", "vb-arena-score-btn", glyph);
        b.type = "button";
        b.setAttribute("aria-label", label);
        b.addEventListener("click", () => adjust(p.uid, delta));
        return b;
      };

      if (controls === "inline") {
        const minus = mkBtn(-1, "−", `Remove 1 point from ${p.name}`);
        const plus = mkBtn(1, "+", `Add 1 point to ${p.name}`);
        row.append(minus, score, plus);
        plate.append(row);
      } else {
        // Anchored: one ± trigger + a small popover with −1 / +1.
        row.append(score);
        const trigger = el("button", "vb-arena-score-btn vb-arena-score-trigger", "±");
        trigger.type = "button";
        trigger.setAttribute("aria-label", `Adjust score for ${p.name}`);
        trigger.setAttribute("aria-haspopup", "true");
        trigger.setAttribute("aria-expanded", "false");
        const popover = el("div", "vb-arena-score-popover");
        popover.setAttribute("role", "group");
        popover.setAttribute("aria-label", `Adjust score for ${p.name}`);
        popover.setAttribute("data-disable-buzz-shortcuts", "");
        popover.hidden = true;
        const minus = mkBtn(-1, "−1", `Remove 1 point from ${p.name}`);
        const plus = mkBtn(1, "+1", `Add 1 point to ${p.name}`);
        popover.append(minus, plus);
        trigger.addEventListener("click", (e) => {
          e.stopPropagation();
          const open = openPopoverUid === p.uid;
          closePopover();
          if (!open) {
            popover.removeAttribute("hidden");
            trigger.setAttribute("aria-expanded", "true");
            openPopoverUid = p.uid;
          }
        });
        row.append(trigger);
        plate.append(row);
        node.append(popover);
      }
    } else {
      const meta = el("div", "vb-arena-plate-score");
      meta.append(score);
      plate.append(meta);
    }

    node.append(avatarWrap, plate);

    if (p.isWinner) {
      const win = el("span", "vb-arena-player-win", "⚡ FIRST!");
      win.setAttribute("aria-hidden", "true");
      node.append(win);
    }

    return node;
  }

  function ensurePodiums(vm: ArenaViewModel, controls: ControlsVariant): void {
    const key = `${vm.visible.map((p) => p.uid).join(",")}|${controls}`;
    if (key === currentBuild) return;
    closePopover();
    currentBuild = key;
    for (const [, node] of podiums) node.remove();
    podiums.clear();
    for (const p of vm.visible) {
      const node = buildPodium(p, opts.isHost ? controls : "plain");
      podiums.set(p.uid, node);
      ring.append(node);
    }
  }

  /* ---------- measured geometry layout ---------- */

  function layout(vm: ArenaViewModel): void {
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    const statusH = statusZone.offsetHeight;
    const feedbackH = feedbackZone.offsetHeight;

    // Controls variant: the anchored trigger + popover (−1 / +1 at 44px)
    // fits every sidebar width; the full inline [− score +] row lives in the
    // host scoring panel below the arena. Non-host stations carry no controls.
    const size: SizeClass = "compact";
    const controls: ControlsVariant = opts.isHost ? (stageW >= 415 ? "inline" : "anchored") : "plain";
    stage.dataset.size = size;
    stage.dataset.controls = controls;
    ensurePodiums(vm, controls);

    const coreRect = centerZone.getBoundingClientRect();
    const first = vm.visible[0] ? podiums.get(vm.visible[0].uid) : undefined;
    const stationRect = first?.getBoundingClientRect();
    const geo = calculateArenaGeometry({
      width: stageW,
      height: stageH,
      statusH,
      feedbackH,
      coreW: coreRect.width,
      coreH: coreRect.height,
      stationW: stationRect?.width ?? 72,
      stationH: stationRect?.height ?? 88,
      playerCount: vm.visible.length,
    });

    stage.dataset.mode = geo.mode;

    // Apply placement: px coordinates, transform centers the composite box.
    const placedUids = new Set<UserId>();
    for (const p of geo.placements) {
      const player = vm.visible[p.index];
      if (!player) continue;
      const node = podiums.get(player.uid);
      if (!node) continue;
      node.hidden = false;
      node.style.left = `${p.x.toFixed(1)}px`;
      node.style.top = `${p.y.toFixed(1)}px`;
      node.classList.toggle(
        "vb-arena-station--edge",
        Math.abs(p.x - geo.centerX) > stageW * 0.3,
      );
      placedUids.add(player.uid);
    }
    for (const [uid, node] of podiums) {
      if (!placedUids.has(uid)) node.hidden = true;
    }

    centerZone.style.left = `${geo.centerX.toFixed(1)}px`;
    centerZone.style.top = `${geo.centerY.toFixed(1)}px`;

    overflowChip.hidden = geo.overflow === 0;
    overflowChip.textContent = geo.overflow > 0 ? `+${geo.overflow} more` : "";

    // Visual state refresh.
    for (const p of vm.visible) {
      const node = podiums.get(p.uid);
      if (!node) continue;
      node.classList.toggle("vb-arena-player--offline", p.presenceState === "offline");
      node.classList.toggle(
        "vb-arena-player--reconnecting",
        p.presenceState === "reconnecting" || p.presenceState === "connecting",
      );
      node.classList.toggle("vb-arena-player--winner", p.isWinner);
      node.classList.toggle("vb-arena-player--locked", vm.roundLocked && !p.isWinner);
    }

    if (import.meta.env.DEV) assertZoneSeparation();
  }

  /* ---------- DEV-ONLY zone-separation assertions ---------- */
  function assertZoneSeparation(): void {
    if (!import.meta.env.DEV) return;
    const warn = (msg: string): void => console.warn("[arena-zones]", msg);
    const hits = (a: DOMRect, b: DOMRect): boolean =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

    const topRect = statusZone.getBoundingClientRect();
    const bottomRect = feedbackZone.getBoundingClientRect();
    const centerRect = centerZone.getBoundingClientRect();
    const btn = centerZone.querySelector(".vb-buzz-btn");

    if (hits(topRect, centerRect)) warn("top status zone overlaps the center zone");
    if (hits(bottomRect, centerRect)) warn("bottom feedback zone overlaps the center zone");

    for (const node of Array.from(ring.querySelectorAll<HTMLElement>(".vb-arena-player"))) {
      if (node.hidden) continue;
      const r = node.getBoundingClientRect();
      const uid = node.dataset.uid ?? "?";
      if (hits(r, topRect)) warn(`station ${uid} intersects the top status zone`);
      if (hits(r, bottomRect)) warn(`station ${uid} intersects the bottom feedback zone`);
      if (btn && hits(r, btn.getBoundingClientRect())) {
        warn(`station ${uid} intersects the central buzzer`);
      }
      // Inline score buttons must remain inside their station box.
      if (node.dataset.controls === "inline") {
        for (const b of Array.from(node.querySelectorAll<HTMLElement>(".vb-arena-score-btn"))) {
          const br = b.getBoundingClientRect();
          const inside =
            br.left >= r.left - 1 &&
            br.right <= r.right + 1 &&
            br.top >= r.top - 1 &&
            br.bottom <= r.bottom + 1;
          if (!inside) warn(`score button outside station ${uid}`);
        }
      }
    }
  }

  /* ---------- dev-only geometry diagnostic ---------- */
  let debugRaf = 0;
  function debugPlayerArenaGeometry(cause: string): void {
    if (!import.meta.env.DEV) return;
    const stageRect = stage.getBoundingClientRect();
    const rows: Array<Record<string, string | number>> = [];
    const overlaps: string[] = [];
    const boxes: Array<{ name: string; r: DOMRect }> = [];

    boxes.push({ name: "stage", r: stageRect });
    boxes.push({ name: "top-status", r: statusZone.getBoundingClientRect() });
    boxes.push({ name: "bottom-feedback", r: feedbackZone.getBoundingClientRect() });
    boxes.push({ name: "center", r: centerZone.getBoundingClientRect() });
    const btn = stage.querySelector<HTMLElement>(".vb-buzz-btn");
    if (btn) boxes.push({ name: "buzz-btn", r: btn.getBoundingClientRect() });
    for (const node of Array.from(ring.querySelectorAll<HTMLElement>(".vb-arena-player"))) {
      if (!node.hidden) boxes.push({ name: `player:${node.dataset.uid ?? "?"}`, r: node.getBoundingClientRect() });
    }

    for (const b of boxes) {
      rows.push({
        name: b.name,
        x: Math.round(b.r.left),
        y: Math.round(b.r.top),
        w: Math.round(b.r.width),
        h: Math.round(b.r.height),
      });
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!.r;
        const b = boxes[j]!.r;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
          overlaps.push(`${boxes[i]!.name} × ${boxes[j]!.name}`);
        }
      }
    }
    console.warn(
      `[arena-geometry] cause=${cause} viewport=${window.innerWidth}×${window.innerHeight} ` +
        `stage=${Math.round(stageRect.width)}×${Math.round(stageRect.height)} ` +
        `mode=${stage.dataset.mode} size=${stage.dataset.size} controls=${stage.dataset.controls}`,
    );
    console.table(rows);
    if (overlaps.length) console.warn("[arena-geometry] OVERLAPS:", overlaps);
    else console.info("[arena-geometry] no overlaps detected");
  }
  function scheduleArenaDebug(cause: string): void {
    if (!import.meta.env.DEV) return;
    window.cancelAnimationFrame(debugRaf);
    debugRaf = window.requestAnimationFrame(() => debugPlayerArenaGeometry(cause));
  }
  let debugRo: ResizeObserver | null = null;
  const onArenaResize = (): void => scheduleArenaDebug("resize/orientation");
  const onDocPointerDown = (e: PointerEvent): void => {
    if (openPopoverUid === null) return;
    const node = podiums.get(openPopoverUid);
    if (node && !node.contains(e.target as Node)) closePopover();
  };
  const onDocKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") closePopover();
  };
  function disposeArenaDebug(): void {
    if (!import.meta.env.DEV) return;
    window.cancelAnimationFrame(debugRaf);
    debugRo?.disconnect();
    debugRo = null;
    window.removeEventListener("resize", onArenaResize);
    window.removeEventListener("orientationchange", onArenaResize);
  }

  if (opts.isHost) {
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKeyDown);
  }

  return {
    root,
    mountBuzzPanel(core, status, feedback) {
      centerZone.append(core);
      statusZone.append(status);
      feedbackZone.append(feedback);
      if (import.meta.env.DEV) {
        requestAnimationFrame(() => debugPlayerArenaGeometry("mount"));
      }
    },
    setRoomData(players, round, currentUserId) {
      const vm = getArenaPlayers(players, round, currentUserId);
      onlineBadge.textContent = `${vm.onlineCount} ONLINE`;
      hostBadge.hidden = !players.some((p) => p.isHost);
      layout(vm);
      if (import.meta.env.DEV) scheduleArenaDebug("room-data");
    },
    dispose() {
      podiums.clear();
      disposeArenaDebug();
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onDocKeyDown);
    },
  };
}
