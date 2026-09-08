import {
  BUZZER_SOUNDS,
  BUZZER_SOUND_LABELS,
  DEFAULT_BUZZER_SOUND,
  isValidBuzzerSoundId,
  type BuzzerSoundId,
} from "../../lib/buzzer-sounds";
import {
  getAudioPreferences,
  getAudioStatus,
  previewSound,
  setMuted,
  setPreferredSound,
  setVolume,
  unlockAudioFromUserGesture,
} from "../../services/buzzerAudioService";
import {
  loadLocalBuzzerSound,
  setBuzzerSound,
} from "../../lib/buzzer-sound-store";
import type { UserId } from "../../types";

export interface SoundPanelHandles {
  root: HTMLElement;
  setBlockedHintVisible(visible: boolean): void;
  /** Syncs the mute checkbox + volume slider from external state changes. */
  setMutedState(muted: boolean): void;
  dispose(): void;
}

/**
 * "My buzzer sound" settings — rendered inside the topbar gear modal.
 * The choice is room-INDEPENDENT: persisted globally per user in RTDB
 * (/profiles/{uid}/buzzerSound) and mirrored in localStorage for instant
 * load. Preview plays the mp3 through the shared audio graph.
 */
export function createSoundPanel(opts: { uid: UserId }): SoundPanelHandles {
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

  // Sound selector + preview
  const profileRow = document.createElement("div");
  profileRow.className = "vb-sound-profile-row";
  const profileLabel = document.createElement("label");
  profileLabel.className = "vb-sound-profile-label";
  profileLabel.textContent = "My buzzer sound";
  const select = document.createElement("select");
  select.className = "vb-input vb-sound-select";
  select.setAttribute("aria-label", "My buzzer sound");
  for (const id of BUZZER_SOUNDS) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = BUZZER_SOUND_LABELS[id];
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

  // init from prefs/service + local choice (room-independent)
  const prefs = getAudioPreferences();
  muteCheck.checked = prefs.muted;
  volSlider.value = String(prefs.volume);
  volSlider.disabled = prefs.muted;

  const localChoice = loadLocalBuzzerSound() ?? DEFAULT_BUZZER_SOUND;
  select.value = localChoice;
  setPreferredSound(localChoice);

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
  });

  volSlider.addEventListener("input", () => {
    const v = Number(volSlider.value);
    setVolume(v);
  });

  previewBtn.addEventListener("click", () => {
    const id = select.value as BuzzerSoundId;
    if (!isValidBuzzerSoundId(id)) return;
    // gesture: unlock first, synchronously
    const unlockP = unlockAudioFromUserGesture();
    void unlockP.then((r) => {
      syncEnableVisibility();
      void previewSound(id).catch(() => {
        announce("Preview failed");
      });
      if (import.meta.env.DEV) console.debug("[audio] preview", id, r.status);
    });
  });

  select.addEventListener("change", () => {
    const id = select.value as BuzzerSoundId;
    if (!isValidBuzzerSoundId(id)) return;
    // gesture unlock synchronously before async work
    const unlockP = unlockAudioFromUserGesture();
    void unlockP.then(() => syncEnableVisibility());
    setPreferredSound(id);
    // Persist globally (room-independent) — RTDB + localStorage mirror.
    void setBuzzerSound(opts.uid, id)
      .then(() => {
        if (import.meta.env.DEV) console.debug("[audio] sound saved", id);
      })
      .catch((err) => {
        announce("Could not save buzzer sound");
        if (import.meta.env.DEV) console.warn("[audio] save failed", err);
      });
  });

  return {
    root,
    setBlockedHintVisible(visible) {
      blockedHint.hidden = !visible;
      if (visible) blockedHint.textContent = "Enable game sounds for future buzzes";
      syncEnableVisibility();
    },
    setMutedState(muted) {
      muteCheck.checked = muted;
      volSlider.disabled = muted;
    },
    dispose() {
      // no listeners to remove beyond root removal; liveRegion etc will be GC'd
    },
  };
}
