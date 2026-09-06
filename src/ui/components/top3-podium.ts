import type { ParticipantView } from "../../types/participant";

export interface Top3PodiumHandles {
  root: HTMLElement;
  /** Re-renders the top-3 ranking from the participants snapshot. */
  setParticipants(players: ParticipantView[]): void;
}

const MEDALS = ["🥇", "🥈", "🥉"] as const;

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
 * Header "TOP 3" podium — DESKTOP ONLY (CSS shows it at ≥1100px; it stays
 * `display:none` on every narrower viewport, so the one-line mobile header
 * is untouched). Pure read-only rendering from the participants snapshot:
 * no Firebase writes, no subscriptions of its own — main.ts already feeds
 * the participants list through the room view.
 *
 * Renders at most the three best-scoring players, rank 1 highlighted in
 * amber. Fewer than 3 players is fine; an empty room hides the pill.
 */
export function createTop3Podium(): Top3PodiumHandles {
  const root = el("div", "vb-top3");
  root.setAttribute("role", "status");
  root.setAttribute("aria-label", "Top 3 players");

  const label = el("span", "vb-top3-label");
  const labelIcon = el("span", "vb-top3-label-icon", "🏆");
  labelIcon.setAttribute("aria-hidden", "true");
  const labelText = el("span", "vb-top3-label-text", "TOP 3");
  label.append(labelIcon, labelText);

  const list = el("div", "vb-top3-list");
  root.append(label, list);

  function initialsOf(name: string): string {
    return (
      name
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("") || "?"
    );
  }

  function render(players: ParticipantView[]): void {
    list.replaceChildren();
    const ranked = [...players].sort((a, b) => b.score - a.score).slice(0, 3);
    if (ranked.length === 0) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    ranked.forEach((p, index) => {
      const slot = el("span", "vb-top3-player");
      if (index === 0) slot.classList.add("vb-top3-player--lead");

      const medal = el("span", "vb-top3-medal", MEDALS[index] ?? String(index + 1));
      medal.setAttribute("aria-hidden", "true");

      const avatar = el("span", "vb-top3-avatar", initialsOf(p.name));
      avatar.style.setProperty("--player-color", p.color);
      avatar.setAttribute("aria-hidden", "true");

      const name = el("span", "vb-top3-name", p.name);
      name.title = p.name; // long names ellipsize, full name on hover

      const score = el("span", "vb-top3-score", String(p.score));

      // Color is reinforcement only — the name carries the identity.
      slot.append(medal, avatar, name, score);
      list.append(slot);

      if (index < ranked.length - 1) {
        const divider = el("span", "vb-top3-divider");
        divider.setAttribute("aria-hidden", "true");
        list.append(divider);
      }
    });
  }

  return {
    root,
    setParticipants(players) {
      render(players);
    },
  };
}
