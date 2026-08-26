import type { UserId } from "../../types/common";
import {
  type StagePlayer,
  type StageViewModel,
  MAX_PROMINENT_PODIUMS,
  presenceLabel,
} from "../../lib/stage-selectors";
import { createGeneratedAvatar, getStableAvatarSeed } from "./generated-avatar";

interface PodiumPlayerHandle {
  root: HTMLElement;
  update(p: StagePlayer): void;
}

interface MoreCardHandle {
  root: HTMLElement;
  setCount(n: number): void;
}

export interface BuzzerStageHandles {
  root: HTMLElement;
  setPlayers(vm: StageViewModel): void;
  /**
   * Called when the authoritative RTDB round update shows a confirmed buzz.
   * One-shot animation per stable key; late joiners render static state only.
   */
  notifyBuzzEvent(ev: {
    buzzEventKey: string;
    winnerId: UserId;
    /** True when this is the first round snapshot (refresh / late join). */
    isInitialSnapshot: boolean;
  }): void;
  /** Gentle illumination of the local player's podium while their transaction is in flight. */
  setPending(uid: UserId, pending: boolean): void;
  /** Clears transient locked/status visuals when the round leaves "buzzed". */
  clearBuzzVisual(): void;
  dispose(): void;
}

/**
 * The Buzzer Stage: a compact, game-show style row of participant podiums.
 * Pure visual enhancement — derives everything from StageViewModel (which is
 * itself derived from existing room/presence/round data). No Firebase writes.
 *
 * Podiums are keyed by uid and updated in place (appendChild reorders without
 * recreating nodes) so the DOM stays stable between renders.
 */
export function createBuzzerStage(): BuzzerStageHandles {
  const root = document.createElement("section");
  root.className = "vb-stage";
  root.setAttribute("aria-label", "Buzzer stage — live player podiums");

  const track = document.createElement("div");
  track.className = "vb-stage__track";
  root.append(track);

  // Compact status strip — populated from authoritative round state only.
  const statusStrip = document.createElement("p");
  statusStrip.className = "vb-stage__status";
  statusStrip.setAttribute("role", "status");
  statusStrip.setAttribute("aria-live", "polite");
  root.append(statusStrip);

  const handles = new Map<UserId, PodiumPlayerHandle>();
  let moreCard: MoreCardHandle | null = null;

  function createPodium(): PodiumPlayerHandle {
    const el = document.createElement("div");
    el.className = "vb-podium";

    const firstBadge = document.createElement("span");
    firstBadge.className = "vb-podium__first-badge";
    firstBadge.setAttribute("aria-hidden", "true");
    firstBadge.textContent = "⚡ FIRST!";

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "vb-podium__avatar";

    const name = document.createElement("div");
    name.className = "vb-podium__name";

    const meta = document.createElement("div");
    meta.className = "vb-podium__meta";

    const dot = document.createElement("span");
    dot.className = "vb-podium__dot";

    const score = document.createElement("span");
    score.className = "vb-podium__score";

    const youTag = document.createElement("span");
    youTag.className = "vb-podium__you";
    youTag.textContent = "You";

    meta.append(dot, score);
    el.append(firstBadge, avatarWrap, name, meta, youTag);

    let builtSeed = "";

    function update(p: StagePlayer): void {
      // Rebuild the avatar only when the identity seed changes (never in practice).
      if (builtSeed !== p.avatarSeed) {
        builtSeed = p.avatarSeed;
        avatarWrap.replaceChildren(
          createGeneratedAvatar({
            seed: getStableAvatarSeed(p.avatarSeed),
            color: p.color,
            name: p.name,
          }).root,
        );
      }
      name.textContent = p.name;
      score.textContent = String(p.score);
      el.style.setProperty("--podium-color", p.color);
      dot.className = `vb-podium__dot vb-podium__dot--${p.presenceState}`;
      el.classList.toggle("vb-podium--you", p.isCurrentUser);
      el.classList.toggle("vb-podium--winner", p.isWinner);
      el.classList.toggle("vb-podium--offline", p.presenceState === "offline");
      el.classList.toggle("vb-podium--host", p.isHost);

      const label =
        `${p.name}${p.isCurrentUser ? " (you)" : ""}, ` +
        `${presenceLabel(p.presenceState)}` +
        `${p.isWinner ? ", buzzed first" : ""}, ` +
        `${p.score} point${p.score === 1 ? "" : "s"}`;
      el.setAttribute("role", "group");
      el.setAttribute("aria-label", label);
    }

    return { root: el, update };
  }

  function createMoreCard(): MoreCardHandle {
    const el = document.createElement("div");
    el.className = "vb-podium vb-podium--more";
    const plus = document.createElement("div");
    plus.className = "vb-podium__more-count";
    el.append(plus);
    el.setAttribute("role", "group");
    function setCount(n: number): void {
      plus.textContent = `+${n}`;
      el.setAttribute("aria-label", `${n} more players not shown on stage`);
    }
    return { root: el, setCount };
  }

  function setPlayers(vm: StageViewModel): void {
    // Derived locked/status state — appears identically for every client.
    root.classList.toggle("vb-stage--has-buzz", vm.roundLocked);
    statusStrip.textContent = vm.statusText ?? "";
    statusStrip.classList.toggle("vb-stage__status--active", !!vm.statusText);

    const desiredUids = new Set(vm.visible.map((p) => p.uid));

    // Drop podiums no longer visible.
    for (const [uid, h] of handles) {
      if (!desiredUids.has(uid)) {
        h.root.remove();
        handles.delete(uid);
      }
    }

    // Update + reorder (appendChild moves existing nodes into order).
    for (const p of vm.visible) {
      let h = handles.get(p.uid);
      if (!h) {
        h = createPodium();
        handles.set(p.uid, h);
      }
      h.update(p);
      track.append(h.root);
    }

    // "+N" overflow card.
    if (vm.overflowCount > 0) {
      if (!moreCard) moreCard = createMoreCard();
      moreCard.setCount(vm.overflowCount);
      track.append(moreCard.root);
    } else if (moreCard) {
      moreCard.root.remove();
      moreCard = null;
    }

    updateDevInspector(vm);
    if (import.meta.env.DEV) onResizeCheck();
  }

  /* ---------------- Dev-only stage inspector ---------------- */

  let devPanel: HTMLElement | null = null;

  function updateDevInspector(vm: StageViewModel): void {
    if (!import.meta.env.DEV) return;
    if (!devPanel) {
      devPanel = document.createElement("div");
      devPanel.className = "vb-dev-stage";
      document.body.append(devPanel);
    }
    const lines: string[] = [];
    lines.push(
      `[stage] visible=${vm.visible.length} overflow=${vm.overflowCount} total=${vm.total}`,
    );
    if (vm.visible.length > MAX_PROMINENT_PODIUMS) {
      lines.push(`WARN: rendering exceeds ${MAX_PROMINENT_PODIUMS} prominent podiums`);
    }
    for (const p of vm.visible) {
      lines.push(
        `  ${p.name} tier=${p.sortTier} score=${p.score}` +
          `${p.isWinner ? " WIN" : ""}${p.isCurrentUser ? " YOU" : ""} ${p.presenceState}`,
      );
    }
    devPanel.textContent = lines.join("\n");
  }

  function onResizeCheck(): void {
    if (!import.meta.env.DEV || !devPanel) return;
    const stageRect = root.getBoundingClientRect();
    if (stageRect.height > 240) {
      devPanel.textContent += `\nWARN: stage height ${Math.round(stageRect.height)}px exceeds 240px`;
    }
    const btn = document.querySelector<HTMLButtonElement>(".vb-buzz-btn");
    if (btn) {
      const btnRect = btn.getBoundingClientRect();
      if (btnRect.bottom > window.innerHeight || btnRect.top < 0) {
        devPanel.textContent += "\nWARN: BUZZ button pushed below viewport";
      }
    }
  }

  if (import.meta.env.DEV) {
    window.addEventListener("resize", onResizeCheck, { passive: true });
  }

  /* ---------------- Buzz animation event system ---------------- */
  // Purely local, keyed by the authoritative Firebase event. No timers for
  // game state — one short visual timer removes the transient flash class.
  const processedBuzzKeys = new Set<string>();
  let flashTimer: number | null = null;

  function devStageLog(...args: unknown[]): void {
    if (import.meta.env.DEV) console.debug("[stage]", ...args);
  }

  function clearFlashTimer(): void {
    if (flashTimer !== null) {
      window.clearTimeout(flashTimer);
      flashTimer = null;
      devStageLog("visual timer cleaned up");
    }
  }

  function playWinnerFlash(winnerId: UserId): void {
    const handle = handles.get(winnerId);
    if (!handle) return;
    const el = handle.root;
    el.classList.remove("vb-podium--buzz-flash");
    void el.offsetWidth; // restart CSS animation
    el.classList.add("vb-podium--buzz-flash");
    clearFlashTimer();
    // Visual-only cleanup after the animation window (<900ms total sequence).
    flashTimer = window.setTimeout(() => {
      el.classList.remove("vb-podium--buzz-flash");
      flashTimer = null;
      devStageLog("buzz flash animation finished, class removed");
    }, 680);
    devStageLog("winner animation played", winnerId);
  }

  return {
    root,
    setPlayers,
    notifyBuzzEvent(ev) {
      devStageLog(`observed buzz event ${ev.buzzEventKey}`);
      if (processedBuzzKeys.has(ev.buzzEventKey)) {
        devStageLog("skipped: already processed", ev.buzzEventKey);
        return;
      }
      processedBuzzKeys.add(ev.buzzEventKey);
      if (ev.isInitialSnapshot) {
        // Late join / refresh: static winner state already rendered via
        // setPlayers (--winner classes). Never replay entrance animations.
        devStageLog("late-join static state rendered (no animation)", ev.buzzEventKey);
        return;
      }
      playWinnerFlash(ev.winnerId);
    },
    setPending(uid, pending) {
      const handle = handles.get(uid);
      if (!handle) return;
      handle.root.classList.toggle("vb-podium--pending", pending);
      devStageLog("pending podium light", uid, pending ? "on" : "off");
    },
    clearBuzzVisual() {
      root.classList.remove("vb-stage--has-buzz");
      statusStrip.textContent = "";
      statusStrip.classList.remove("vb-stage__status--active");
      for (const h of handles.values()) {
        h.root.classList.remove("vb-podium--buzz-flash");
      }
      clearFlashTimer();
    },
    dispose() {
      clearFlashTimer();
      processedBuzzKeys.clear();
      if (import.meta.env.DEV) {
        devPanel?.remove();
        window.removeEventListener("resize", onResizeCheck);
      }
    },
  };
}
