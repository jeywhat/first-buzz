import type { ParticipantView, RoundData, UserId } from "../../types";

export interface BuzzerStageHandles {
  root: HTMLElement;
  /** Mounts the ONE canonical mechanical buzzer: core → zone, feedback → live region. */
  mountBuzzPanel(core: HTMLElement, feedback: HTMLElement): void;
  setRoomData(players: ParticipantView[], round: RoundData | null, currentUserId: UserId): void;
  dispose(): void;
}

/**
 * Buzzer stage — the former Player Arena zone, now dedicated entirely to the
 * large mechanical buzzer. GEOMETRIC STABILITY: the stage renders exactly
 * three rows — header, buzzer zone, short live status — with NOTHING
 * conditional between them. Round metadata (round pill, VIDEO PAUSED, winner
 * name/time) lives exclusively in the .vb-buzz-popup-region below the video,
 * so the buzzer keeps the same position and size in every round state.
 *
 * DOM:
 *   section.vb-buzzer-stage
 *     header.vb-buzzer-stage-header   — title + compact online badge
 *     .vb-mechanical-buzzer-zone      — the ONE canonical buzzer button
 *     .vb-buzzer-status               — aria-live short local status line
 */
export function createBuzzerStage(): BuzzerStageHandles {
  const root = document.createElement("section");
  root.className = "vb-buzzer-stage";
  root.setAttribute("aria-labelledby", "buzzer-stage-title");

  /* ---------- header ---------- */
  const header = document.createElement("header");
  header.className = "vb-buzzer-stage-header";

  const title = document.createElement("h2");
  title.className = "vb-buzzer-stage-title";
  title.id = "buzzer-stage-title";
  title.textContent = "Buzzer";

  const badge = document.createElement("span");
  badge.className = "vb-buzzer-online";
  badge.textContent = "0 ONLINE";
  badge.setAttribute("aria-label", "0 players online");

  header.append(title, badge);

  /* ---------- buzzer zone ---------- */
  const zone = document.createElement("div");
  zone.className = "vb-mechanical-buzzer-zone";

  /* ---------- live status ---------- */
  const liveStatus = document.createElement("div");
  liveStatus.className = "vb-buzzer-status";
  liveStatus.id = "vb-buzzer-status";
  liveStatus.setAttribute("aria-live", "polite");
  liveStatus.setAttribute("aria-atomic", "true");

  root.append(header, zone, liveStatus);

  return {
    root,
    mountBuzzPanel(core, feedback) {
      zone.append(core);
      liveStatus.append(feedback);
    },
    setRoomData(players, round, currentUserId) {
      void round;
      void currentUserId;
      const online = players.filter((p) => p.presenceState === "online").length;
      badge.textContent = `${online} ONLINE`;
    },
    dispose() {
      // No listeners of its own — the buzz panel owns the button lifecycle.
    },
  };
}
