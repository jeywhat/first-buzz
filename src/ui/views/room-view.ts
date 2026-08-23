import { renderConnectionBadge } from "../components/connection-badge";
import { renderParticipantList } from "../components/participant-list";
import type { RoomViewHandles } from "../types";

/**
 * Room page — responsive, desktop-first game interface.
 *
 * DOM (see .vb-room-page/.vb-room-shell in styles.css):
 *   main.vb-room-page
 *     div.vb-room-shell
 *       header.vb-room-header   — brand, room code + copy, status pills, leave
 *       div.vb-room-main
 *         div.vb-room-primary   — video region, buzzer (main.ts appends)
 *         aside.vb-room-sidebar — host controls, scoreboard, diagnostics
 */
export function renderRoomView(opts: {
  code: string;
  isHost: boolean;
  onLeave(): void;
}): RoomViewHandles {
  const root = document.createElement("main");
  root.className = "vb-room-page";

  const shell = document.createElement("div");
  shell.className = "vb-room-shell";

  /* ---------- Header ---------- */

  const header = document.createElement("header");
  header.className = "vb-room-header";

  const brand = document.createElement("span");
  brand.className = "vb-brand";
  brand.textContent = "Video Buzzer";

  // Room code + copy invite — compact, always visible.
  const codeGroup = document.createElement("div");
  codeGroup.className = "vb-header-code";

  const codeEl = document.createElement("span");
  codeEl.className = "vb-code";
  codeEl.textContent = opts.code;

  const copyBtn = document.createElement("button");
  copyBtn.className = "vb-btn vb-btn--ghost vb-btn--small";
  copyBtn.textContent = "Copy link";
  copyBtn.setAttribute("aria-label", "Copy invite link");

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

  codeGroup.append(codeEl, copyBtn);

  // Status pills: round state + connected player count.
  const roundBadge = document.createElement("span");
  roundBadge.className = "vb-status-pill";
  roundBadge.hidden = true;

  const playerCount = document.createElement("span");
  playerCount.className = "vb-status-pill";
  playerCount.hidden = true;

  const badge = renderConnectionBadge();

  const hostTag = document.createElement("span");
  hostTag.className = "vb-host-tag";
  hostTag.hidden = !opts.isHost;
  hostTag.textContent = "Host";

  const leaveBtn = document.createElement("button");
  leaveBtn.className = "vb-btn vb-btn--ghost vb-btn--small";
  leaveBtn.textContent = "← Leave";
  leaveBtn.addEventListener("click", () => opts.onLeave());

  header.append(brand, codeGroup, roundBadge, playerCount, badge.root, hostTag, leaveBtn);

  /* ---------- Connection banner ---------- */

  const connBanner = document.createElement("div");
  connBanner.className = "vb-conn-banner";
  connBanner.setAttribute("role", "alert");
  connBanner.hidden = true;
  connBanner.textContent = "Connection lost — reconnecting…";

  /* ---------- Main grid ---------- */

  const mainArea = document.createElement("div");
  mainArea.className = "vb-room-main";

  // Primary column: video region + buzzer (main.ts appends player/buzzer).
  const primary = document.createElement("div");
  primary.className = "vb-room-primary";

  const videoRegion = document.createElement("div");
  videoRegion.className = "vb-video-region";

  const primaryActions = document.createElement("div");
  primaryActions.className = "vb-primary-actions";

  videoRegion.append(); // player root appended by main.ts
  primary.append(videoRegion, primaryActions);

  // Sidebar: host controls, scoreboard, hint, diagnostics.
  const sidebar = document.createElement("aside");
  sidebar.className = "vb-room-sidebar";

  const participants = renderParticipantList();

  const hint = document.createElement("p");
  hint.className = "vb-hint";
  hint.textContent = "Share the link — answers are given by voice on Discord.";

  sidebar.append(participants.root, hint);

  mainArea.append(primary, sidebar);
  shell.append(header, connBanner, mainArea);
  root.append(shell);

  return {
    root,
    videoColumn: videoRegion,
    primaryColumn: primaryActions,
    sidebar,
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
    setPlayerCount(online, total) {
      playerCount.hidden = total === 0;
      playerCount.textContent = `${online}/${total} online`;
    },
  };
}
