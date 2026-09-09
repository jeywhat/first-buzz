import { renderConnectionBadge } from "../components/connection-badge";
import { renderParticipantList } from "../components/participant-list";
import { createTop3Podium } from "../components/top3-podium";
import { createSettingsModal } from "../components/settings-modal";
import { createThemeToggle } from "../../lib/theme";
import type { RoomViewHandles } from "../types";
import type { ParticipantView } from "../../types/participant";

/**
 * BuzzTube.io room page — Neo-Arcade light theme.
 *
 * DOM:
 *   main.vb-room-page
 *     header.vb-topbar            — brand, room chip, sound?, identity, leave
 *     div.vb-room-main
 *       section.vb-video-column
 *         section.vb-video-card
 *           div.vb-video-meta     — YouTube badge + title chip
 *           div.vb-video-shell    — player mounts here (neutral context)
 *           div.vb-buzz-popup-region
 *       aside.vb-game-sidebar
 *         (arenaSlot)             — Buzzer stage w/ mechanical buzzer
 *         participants            — Players panel: presence, avatar, score,
 *                                   host-only −/+ adjustments (single source)
 *         (host tools appended by main.ts)
 *         settings drawer         — sound + diagnostics + advanced scoring
 */
export function renderRoomView(opts: {
  code: string;
  uid: string;
  isHost: boolean;
  onLeave(): void;
  /** Canonical host score adjustment (adjustPlayerScore via main.ts). */
  onAdjustScore(targetUid: string, delta: number): Promise<void>;
}): RoomViewHandles {
  const root = document.createElement("main");
  root.className = "vb-room-page";

  /* ---------- Top bar ---------- */

  const header = document.createElement("header");
  header.className = "vb-topbar";

  const headerLeft = document.createElement("div");
  headerLeft.className = "vb-topbar-left";

  const brand = document.createElement("div");
  brand.className = "vb-brand";
  const brandIcon = document.createElement("span");
  brandIcon.className = "vb-brand-icon";
  brandIcon.setAttribute("aria-hidden", "true");
  brandIcon.textContent = "▶";
  const brandText = document.createElement("span");
  brandText.className = "vb-brand-text";
  brandText.innerHTML = "";
  brandText.append("BuzzTube", Object.assign(document.createElement("span"), { className: "vb-brand-tld", textContent: ".io" }));
  brand.append(brandIcon, brandText);

  const divider = document.createElement("span");
  divider.className = "vb-topbar-divider";
  divider.setAttribute("aria-hidden", "true");

  const codeGroup = document.createElement("div");
  codeGroup.className = "vb-room-chip";
  const codeLabel = document.createElement("span");
  codeLabel.className = "vb-room-chip-label";
  codeLabel.textContent = "PARTIE";
  const codeEl = document.createElement("span");
  codeEl.className = "vb-room-chip-code";
  codeEl.textContent = `#${opts.code}`;

  const copyBtn = document.createElement("button");
  copyBtn.className = "vb-room-chip-copy";
  copyBtn.type = "button";
  copyBtn.textContent = "⧉";
  copyBtn.setAttribute("aria-label", "Copy invite link");

  let resetTimer = 0;
  function flash(text: string): void {
    copyBtn.textContent = text;
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      copyBtn.textContent = "⧉";
    }, 1400);
  }

  copyBtn.addEventListener("click", () => {
    // Canonical room URL — no legacy ?room= query duplication.
    const link = `${location.origin}/room/${opts.code}`;
    navigator.clipboard.writeText(link).then(
      () => flash("OK!"),
      () => flash("…"),
    );
  });

  codeGroup.append(codeLabel, codeEl, copyBtn);
  headerLeft.append(brand, divider, codeGroup);

  const headerRight = document.createElement("div");
  headerRight.className = "vb-topbar-right";

  const badge = renderConnectionBadge();

  // Identity card — updated live via setParticipants (self lookup).
  const identity = document.createElement("div");
  identity.className = "vb-identity";
  const identityAvatar = document.createElement("span");
  identityAvatar.className = "vb-identity-avatar";
  identityAvatar.textContent = "–";
  identityAvatar.setAttribute("aria-hidden", "true");
  const identityText = document.createElement("span");
  identityText.className = "vb-identity-text";
  const identityName = document.createElement("span");
  identityName.className = "vb-identity-name";
  identityName.textContent = "…";
  const identityScore = document.createElement("span");
  identityScore.className = "vb-identity-score";
  identityScore.textContent = "0 pts";
  identityText.append(identityName, identityScore);
  identity.append(identityAvatar, identityText);

  const hostTag = document.createElement("span");
  hostTag.className = "vb-host-tag";
  hostTag.hidden = !opts.isHost;
  hostTag.textContent = "👑 HOST";

  const leaveBtn = document.createElement("button");
  leaveBtn.type = "button";
  leaveBtn.className = "vb-btn vb-btn--ghost vb-btn--small vb-leave-btn";
  // Open-door icon (red on mobile) — text stays for desktop widths.
  const leaveIcon = document.createElement("span");
  leaveIcon.className = "vb-leave-icon";
  leaveIcon.setAttribute("aria-hidden", "true");
  leaveIcon.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M3 12h12"/><path d="m11 8 4 4-4 4"/></svg>';
  const leaveText = document.createElement("span");
  leaveText.className = "vb-leave-text";
  leaveText.textContent = "Leave";
  leaveBtn.append(leaveIcon, leaveText);
  leaveBtn.setAttribute("aria-label", "Leave room");
  leaveBtn.addEventListener("click", () => opts.onLeave());

  // Settings gear + modal — per-user preferences (buzzer sound), independent
  // of the room. The modal content slot is filled by main.ts.
  const settingsModal = createSettingsModal();

  headerRight.append(createThemeToggle(), settingsModal.button, badge.root, identity, hostTag, leaveBtn);

  // TOP 3 podium — header MIDDLE, DESKTOP ONLY (CSS shows it at ≥1100px;
  // hidden on every narrower viewport). Rendered from the participants
  // snapshot in setParticipants — read-only, no Firebase involvement.
  const top3 = createTop3Podium();
  header.append(headerLeft, top3.root, headerRight);
  // The modal overlay lives at the page root so it is never clipped by the
  // topbar's stacking context.
  root.append(settingsModal.modalRoot);

  /* ---------- Connection banner ---------- */

  const connBanner = document.createElement("div");
  connBanner.className = "vb-conn-banner";
  connBanner.setAttribute("role", "alert");
  connBanner.hidden = true;
  connBanner.textContent = "Connection lost — reconnecting…";

  /* ---------- Main grid ---------- */

  const mainArea = document.createElement("div");
  mainArea.className = "vb-room-main";

  const videoColumn = document.createElement("section");
  videoColumn.className = "vb-video-column";

  const videoCard = document.createElement("section");
  videoCard.className = "vb-video-card";

  const videoMeta = document.createElement("div");
  videoMeta.className = "vb-video-meta";
  const sourceBadge = document.createElement("span");
  sourceBadge.className = "vb-source-badge";
  sourceBadge.textContent = "▶ YOUTUBE";
  const titleChip = document.createElement("span");
  titleChip.className = "vb-video-title-chip";
  titleChip.textContent = "Live quiz arena";
  videoMeta.append(sourceBadge, titleChip);

  const videoShell = document.createElement("div");
  videoShell.className = "vb-video-shell";
  // (player root + idle empty state are inserted here by main.ts)

  const buzzPopupRegion = document.createElement("div");
  buzzPopupRegion.className = "vb-buzz-popup-region";
  buzzPopupRegion.setAttribute("role", "status");
  buzzPopupRegion.setAttribute("aria-live", "polite");
  buzzPopupRegion.setAttribute("aria-atomic", "true");

  videoCard.append(videoMeta, videoShell, buzzPopupRegion);
  videoColumn.append(videoCard);

  /* ---------- Sidebar ---------- */

  const sidebar = document.createElement("aside");
  sidebar.className = "vb-game-sidebar";

  const arenaSlot = document.createElement("div");
  arenaSlot.className = "vb-buzzer-slot";

  const participants = renderParticipantList({
    uid: opts.uid,
    isHost: opts.isHost,
    onAdjust: (target, delta) => opts.onAdjustScore(target.uid, delta),
  });

  const settings = document.createElement("details");
  settings.className = "vb-settings-drawer";
  const settingsSummary = document.createElement("summary");
  settingsSummary.textContent = "⚙️ Settings & diagnostics";
  const settingsContent = document.createElement("div");
  settingsContent.className = "vb-settings-content";
  settings.append(settingsSummary, settingsContent);

  sidebar.append(arenaSlot, participants.root, settings);

  mainArea.append(videoColumn, sidebar);
  root.append(header, connBanner, mainArea);

  return {
    root,
    videoColumn: videoShell,
    buzzPopupColumn: buzzPopupRegion,
    arenaSlot,
    settingsContent,
    settingsModal,
    titleChip,
    identity: { avatar: identityAvatar, name: identityName, score: identityScore, root: identity },
    sidebar,
    setParticipants: (list: ParticipantView[]) => {
      participants.setParticipants(list);
      top3.setParticipants(list);
      const me = list.find((p) => p.uid === opts.uid) ?? null;
      if (me) {
        identityName.textContent = me.name;
        identityScore.textContent = `${me.score} pts`;
        identityAvatar.style.setProperty("--player-color", me.color);
        identityAvatar.textContent = me.name
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase() ?? "")
          .join("");
      }
    },
    setConnectionState(online) {
      badge.setOnline(online);
      connBanner.hidden = online;
    },
    setRoundStatus(state) {
      // Rounds are no longer a user-facing concept: the chip stays neutral
      // except for the two states players actually react to.
      titleChip.dataset.state = state ?? "";
      titleChip.textContent =
        state === "buzzed" ? "Buzz!" : state === "cooldown" ? "Next buzz soon…" : "Live quiz arena";
    },
    setPlayerCount(online, total) {
      void online;
      void total; // header identity + buzzer badge carry counts now
    },
  };
}
