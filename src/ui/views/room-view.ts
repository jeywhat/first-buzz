import { renderConnectionBadge } from "../components/connection-badge";
import { renderParticipantList } from "../components/participant-list";
import type { RoomViewHandles } from "../types";

export function renderRoomView(opts: {
  code: string;
  isHost: boolean;
  onLeave(): void;
}): RoomViewHandles {
  const root = document.createElement("main");
  root.className = "vb-room";

  // Prominent network banner (a11y: announced via role=alert).
  const connBanner = document.createElement("div");
  connBanner.className = "vb-conn-banner";
  connBanner.setAttribute("role", "alert");
  connBanner.hidden = true;
  connBanner.textContent = "Connection lost — reconnecting…";

  /* ---------- Round status pill (always visible) ---------- */
  const roundBadge = document.createElement("span");
  roundBadge.className = "vb-status-pill";
  roundBadge.hidden = true;

  // Header: leave action + live connection badge
  const header = document.createElement("div");
  header.className = "vb-room__header";

  const leaveBtn = document.createElement("button");
  leaveBtn.className = "vb-btn vb-btn--ghost vb-btn--small";
  leaveBtn.textContent = "← Leave";
  leaveBtn.addEventListener("click", () => opts.onLeave());

  const badge = renderConnectionBadge();
  header.append(leaveBtn, badge.root);

  // Shareable code card
  const card = document.createElement("section");
  card.className = "vb-code-card";

  const cardTop = document.createElement("div");
  cardTop.className = "vb-code-card__top";

  const codeLabel = document.createElement("span");
  codeLabel.className = "vb-label";
  codeLabel.textContent = "Room code";

  cardTop.append(codeLabel);
  if (opts.isHost) {
    const hostTag = document.createElement("span");
    hostTag.className = "vb-host-tag";
    hostTag.textContent = "You are the host";
    cardTop.append(hostTag);
  }
  cardTop.append(roundBadge);

  const codeRow = document.createElement("div");
  codeRow.className = "vb-code-row";

  const codeEl = document.createElement("span");
  codeEl.className = "vb-code";
  codeEl.textContent = opts.code;

  const copyBtn = document.createElement("button");
  copyBtn.className = "vb-btn vb-btn--ghost vb-btn--small";
  copyBtn.textContent = "Copy link";

  let resetTimer = 0;
  function flash(text: string): void {
    copyBtn.textContent = text;
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      copyBtn.textContent = "Copy link";
    }, 1400);
  }

  copyBtn.addEventListener("click", () => {
    const link = `${location.origin}${location.pathname}?room=${opts.code}`;
    navigator.clipboard.writeText(link).then(
      () => flash("Copied!"),
      () => flash("Copy failed"),
    );
  });

  codeRow.append(codeEl, copyBtn);
  card.append(cardTop, codeRow);

  const hint = document.createElement("p");
  hint.className = "vb-hint";
  hint.textContent = "Share the link — answers are given by voice on Discord.";

  const participants = renderParticipantList();

  // Responsive room grid: flexible video column + fixed sidebar (code/scores).
  // Mobile (<900px) collapses to one column with the sidebar below the player.
  const layout = document.createElement("div");
  layout.className = "room-layout";

  const videoColumn = document.createElement("div");
  videoColumn.className = "video-column video-column--main";

  const sidebar = document.createElement("aside");
  sidebar.className = "room-sidebar";
  sidebar.append(card, hint, participants.root);

  layout.append(videoColumn, sidebar);

  root.append(connBanner, header, layout);

  return {
    root,
    bodyTop: videoColumn,
    setParticipants: participants.setParticipants,
    setConnectionState(online) {
      badge.setOnline(online);
      connBanner.hidden = online;
    },
    setRoundStatus(state) {
      roundBadge.hidden = !state;
      roundBadge.dataset.state = state ?? "";
      roundBadge.textContent = state ? `Round · ${state}` : "";
    },
  };
}
