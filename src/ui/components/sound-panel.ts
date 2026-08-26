import {
  BUZZER_SOUND_PROFILES,
  type BuzzerSoundProfileId,
  getAudioPreferences,
  getAudioStatus,
  isValidSoundProfileId,
  previewSoundProfile,
  setMuted,
  setVolume,
  unlockAudioFromUserGesture,
} from "../../services/proceduralBuzzerAudioService";
import { setSoundProfileId } from "../../lib/players";
import type { RoomCode, UserId } from "../../types";

const PROFILE_LABELS: Record<BuzzerSoundProfileId, string> = {
  "classic-buzzer": "Classic Buzzer",
  "arcade-zap": "Arcade Zap",
  "game-show-ding": "Game Show Ding",
  "retro-blip": "Retro Blip",
  "synth-horn": "Synth Horn",
  "laser-pulse": "Laser Pulse",
  "double-chime": "Double Chime",
  "electric-pop": "Electric Pop",
};

export interface SoundPanelHandles {
  root: HTMLElement;
  setProfile(profileId: BuzzerSoundProfileId | null): void;
  setBlockedHintVisible(visible: boolean): void;
  dispose(): void;
}

export function createSoundPanel(opts: {
  code: RoomCode;
  uid: UserId;
  initialProfileId: BuzzerSoundProfileId | null;
}): SoundPanelHandles {
  const root = document.createElement("section");
  root.className = "vb-sound-panel";
  root.setAttribute("aria-label", "Game sound settings");

  const heading = document.createElement("h2");
  heading.className = "vb-section-title";
  heading.textContent = "Sound";

  // aria-live polite region
  const liveRegion = document.createElement("div");
  liveRegion.className = "vb-sound-live";
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("role", "status");

  // Enable game sounds button (shown when not ready)
  const enableBtn = document.createElement("button");
  enableBtn.type = "button";
  enableBtn.className = "vb-btn vb-btn--ghost vb-btn--small vb-sound-enable";
  enableBtn.textContent = "Enable game sounds";
  enableBtn.setAttribute("aria-label", "Enable game sounds");

  const blockedHint = document.createElement("p");
  blockedHint.className = "vb-sound-hint";
  blockedHint.hidden = true;
  blockedHint.textContent = "Enable game sounds for future buzzes";

  // Mute / unmute
  const muteRow = document.createElement("label");
  muteRow.className = "vb-sound-mute-row";
  const muteCheck = document.createElement("input");
  muteCheck.type = "checkbox";
  muteCheck.className = "vb-sound-mute-check";
  const muteText = document.createElement("span");
  muteText.textContent = "Mute";
  muteRow.append(muteCheck, muteText);

  // Volume slider
  const volRow = document.createElement("div");
  volRow.className = "vb-sound-vol-row";
  const volLabel = document.createElement("label");
  volLabel.className = "vb-sound-vol-label";
  volLabel.textContent = "Volume";
  const volSlider = document.createElement("input");
  volSlider.type = "range";
  volSlider.min = "0";
  volSlider.max = "1";
  volSlider.step = "0.05";
  volSlider.className = "vb-sound-vol";
  volSlider.setAttribute("aria-label", "Game sound volume");
  volLabel.append(volSlider);
  volRow.append(volLabel);

  // Profile selector + preview
  const profileRow = document.createElement("div");
  profileRow.className = "vb-sound-profile-row";
  const profileLabel = document.createElement("label");
  profileLabel.className = "vb-sound-profile-label";
  profileLabel.textContent = "My buzzer sound";
  const select = document.createElement("select");
  select.className = "vb-input vb-sound-select";
  select.setAttribute("aria-label", "My buzzer sound profile");
  for (const pid of BUZZER_SOUND_PROFILES) {
    const o = document.createElement("option");
    o.value = pid;
    o.textContent = PROFILE_LABELS[pid];
    select.append(o);
  }
  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "vb-btn vb-btn--ghost vb-btn--small";
  previewBtn.textContent = "Preview";
  previewBtn.setAttribute("aria-label", "Preview buzzer sound");
  profileLabel.append(select);
  profileRow.append(profileLabel, previewBtn);

  root.append(heading, enableBtn, blockedHint, muteRow, volRow, profileRow, liveRegion);

  // init from prefs/service
  const prefs = getAudioPreferences();
  muteCheck.checked = prefs.muted;
  volSlider.value = String(prefs.volume);
  volSlider.disabled = prefs.muted;

  let currentProfile: BuzzerSoundProfileId | null = opts.initialProfileId;
  if (currentProfile && isValidSoundProfileId(currentProfile)) {
    select.value = currentProfile;
  } else if (opts.initialProfileId == null) {
    // will be set via setProfile after ensure
  }

  function syncEnableVisibility(): void {
    const st = getAudioStatus();
    // Show enable button when not ready and not unsupported
    if (st === "ready") {
      enableBtn.hidden = true;
    } else if (st === "unsupported") {
      enableBtn.hidden = true;
      blockedHint.hidden = true;
      blockedHint.textContent = "Audio not supported in this browser";
      blockedHint.hidden = false;
    } else {
      enableBtn.hidden = false;
    }
  }
  syncEnableVisibility();

  function announce(msg: string): void {
    liveRegion.textContent = msg;
  }

  enableBtn.addEventListener("click", () => {
    // Must call unlock synchronously within gesture
    const p = unlockAudioFromUserGesture();
    void p.then((r) => {
      syncEnableVisibility();
      if (r.status === "ready") {
        announce("Game sounds enabled");
        blockedHint.hidden = true;
      } else if (r.status === "blocked") {
        announce("Game sounds blocked by browser");
        blockedHint.hidden = false;
        blockedHint.textContent = "Enable game sounds for future buzzes";
      } else {
        announce("Audio not supported");
      }
    });
  });

  muteCheck.addEventListener("change", () => {
    const m = muteCheck.checked;
    setMuted(m);
    volSlider.disabled = m;
    announce(m ? "Game sounds muted" : "Game sounds unmuted");
    if (import.meta.env.DEV) console.debug("[audio] mute toggled", m);
  });

  volSlider.addEventListener("input", () => {
    const v = Number(volSlider.value);
    setVolume(v);
  });

  previewBtn.addEventListener("click", () => {
    const pid = select.value as BuzzerSoundProfileId;
    if (!isValidSoundProfileId(pid)) return;
    // gesture: unlock first, synchronously
    const unlockP = unlockAudioFromUserGesture();
    void unlockP.then((r) => {
      syncEnableVisibility();
      if (r.status !== "ready" && r.status !== "blocked") {
        // still try preview (service will attempt unlock)
      }
      void previewSoundProfile(pid).catch(() => {
        announce("Preview failed");
      });
      if (import.meta.env.DEV) console.debug("[audio] preview", pid, r.status);
    });
  });

  select.addEventListener("change", () => {
    const pid = select.value as BuzzerSoundProfileId;
    if (!isValidSoundProfileId(pid)) return;
    currentProfile = pid;
    // gesture unlock synchronously before async write
    const unlockP = unlockAudioFromUserGesture();
    void unlockP.then(() => syncEnableVisibility());
    // Persist to Firebase (only own player)
    void setSoundProfileId(opts.code, opts.uid, pid)
      .then(() => {
        if (import.meta.env.DEV) console.debug("[audio] profile saved", pid);
      })
      .catch((err) => {
        announce("Could not save buzzer sound");
        if (import.meta.env.DEV) console.warn("[audio] save failed", err);
      });
    // Also preview locally? Not required, but can preview via separate button only
  });

  // Dev-only test control
  if (import.meta.env.DEV) {
    const devBtn = document.createElement("button");
    devBtn.type = "button";
    devBtn.className = "vb-btn vb-btn--ghost vb-btn--small";
    devBtn.textContent = "Test generated sound";
    devBtn.addEventListener("click", () => {
      const pid = select.value as BuzzerSoundProfileId;
      const unlockP = unlockAudioFromUserGesture();
      void unlockP.then(() => {
        void previewSoundProfile(pid).catch(() => {});
      });
    });
    root.append(devBtn);
  }

  return {
    root,
    setProfile(profileId) {
      if (profileId && isValidSoundProfileId(profileId)) {
        currentProfile = profileId;
        select.value = profileId;
      }
    },
    setBlockedHintVisible(visible) {
      blockedHint.hidden = !visible;
      if (visible) blockedHint.textContent = "Enable game sounds for future buzzes";
      syncEnableVisibility();
    },
    dispose() {
      // no listeners to remove beyond root removal; liveRegion etc will be GC'd
    },
  };
}
