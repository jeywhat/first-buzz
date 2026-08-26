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

  const handles = new Map<UserId, PodiumPlayerHandle>();
  let moreCard: MoreCardHandle | null = null;

  function createPodium(): PodiumPlayerHandle {
    const el = document.createElement("div");
    el.className = "vb-podium";

    const crown = document.createElement("span");
    crown.className = "vb-podium__crown";
    crown.setAttribute("aria-hidden", "true");
    crown.textContent = "★";

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
    el.append(crown, avatarWrap, name, meta, youTag);

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

  return {
    root,
    setPlayers,
    dispose() {
      if (import.meta.env.DEV) {
        devPanel?.remove();
        window.removeEventListener("resize", onResizeCheck);
      }
    },
  };
}
