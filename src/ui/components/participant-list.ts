import type { ParticipantView, PresenceState } from "../../types/participant";

const STATE_LABELS: Record<PresenceState, string> = {
  online: "online",
  connecting: "connecting…",
  reconnecting: "reconnecting…",
  offline: "offline",
};

/** Presence first (online > connecting/reconnecting > offline), then score. */
const STATE_RANK: Record<PresenceState, number> = {
  online: 0,
  connecting: 1,
  reconnecting: 1,
  offline: 2,
};

/** One list row. User-provided names are rendered via textContent only (XSS). */
function row(p: ParticipantView): HTMLElement {
  const li = document.createElement("li");
  li.className =
    "vb-participant" + (p.presenceState === "offline" ? " vb-participant--offline" : "");

  const chip = document.createElement("span");
  chip.className = "vb-chip";
  chip.style.backgroundColor = p.color;

  const name = document.createElement("span");
  name.className = "vb-participant__name";
  name.textContent = p.name;

  if (p.isHost) {
    const host = document.createElement("span");
    host.className = "vb-participant__host";
    host.textContent = "(host)";
    name.append(host);
  }

  const meta = document.createElement("span");
  meta.className = "vb-participant__meta";
  meta.textContent = `${p.score} pts · ${STATE_LABELS[p.presenceState]}`;

  li.append(chip, name, meta);
  return li;
}

/** Scoreboard order: presence, score descending, join order, then name. */
function compare(a: ParticipantView, b: ParticipantView): number {
  const joinA = a.joinedAt ?? Number.MAX_SAFE_INTEGER;
  const joinB = b.joinedAt ?? Number.MAX_SAFE_INTEGER;
  return (
    STATE_RANK[a.presenceState] - STATE_RANK[b.presenceState] ||
    b.score - a.score ||
    joinA - joinB ||
    a.name.localeCompare(b.name)
  );
}

export function renderParticipantList(): {
  root: HTMLElement;
  setParticipants(list: ParticipantView[]): void;
} {
  const root = document.createElement("section");
  root.className = "vb-participants";

  const title = document.createElement("h2");
  title.className = "vb-section-title";
  title.textContent = "Players";

  const listEl = document.createElement("ul");
  listEl.className = "vb-participant-list";

  root.append(title, listEl);

  return {
    root,
    setParticipants(list: ParticipantView[]) {
      const online = list.filter((p) => p.presenceState === "online").length;
      title.textContent =
        list.length === 0 ? "Players" : `Players · ${online}/${list.length} online`;

      if (list.length === 0) {
        const empty = document.createElement("li");
        empty.className = "vb-empty";
        empty.textContent = "Waiting for players…";
        listEl.replaceChildren(empty);
        return;
      }
      listEl.replaceChildren(...[...list].sort(compare).map(row));
    },
  };
}
