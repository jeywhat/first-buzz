/**
 * Buzzer audio — mp3 assets played through one shared Web Audio graph.
 *
 * One AudioContext per tab, lazy-created inside user gestures (browser
 * autoplay policy). Sounds are fetched from /sound_effects, decoded once
 * and cached as AudioBuffers, then routed through a master gain that carries
 * the mute/volume preferences (localStorage).
 *
 * The chosen sound id travels through RTDB (global per-user profile) so the
 * WINNER's sound plays on every client; this module only knows how to play
 * whatever id it is given.
 */

import {
  DEFAULT_BUZZER_SOUND,
  buzzerSoundUrl,
  isValidBuzzerSoundId,
  type BuzzerSoundId,
} from "../lib/buzzer-sounds";

export type AudioStatus = "uninitialized" | "ready" | "blocked" | "unsupported";
export type AudioUnlockResult =
  | { status: "ready" }
  | { status: "blocked"; reason: string }
  | { status: "unsupported"; reason: string };

// ---------------- internal state ----------------

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let audioStatus: AudioStatus = "uninitialized";
const processedEventKeys = new Set<string>();
const activeSources = new Set<AudioScheduledSourceNode>();

/** Decoded mp3 cache — one fetch+decode per sound id per tab. */
const bufferCache = new Map<string, AudioBuffer>();
const pendingDecodes = new Map<string, Promise<AudioBuffer>>();

/** Sound preloaded on unlock so the first buzz has no fetch delay. */
let preferredSoundId: BuzzerSoundId = DEFAULT_BUZZER_SOUND;

const LS_MUTED = "vb-audio-muted";
const LS_VOLUME = "vb-audio-volume";

function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.debug("[audio]", ...args);
}
function devWarn(...args: unknown[]): void {
  if (import.meta.env.DEV) console.warn("[audio]", ...args);
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(LS_MUTED) === "1";
  } catch {
    return false;
  }
}
function loadVolume(): number {
  try {
    const raw = localStorage.getItem(LS_VOLUME);
    if (raw == null) return 0.7;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0.7;
    return clampVolume(n);
  } catch {
    return 0.7;
  }
}
let muted = loadMuted();
let volume = loadVolume(); // 0..1

function savePrefs(): void {
  try {
    localStorage.setItem(LS_MUTED, muted ? "1" : "0");
    localStorage.setItem(LS_VOLUME, String(volume));
  } catch {
    // ignore storage errors
  }
}

function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0.7;
  return Math.min(1, Math.max(0, v));
}

function isAudioSupported(): boolean {
  return typeof window !== "undefined" && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null;
}

function applyMasterGain(): void {
  if (!audioContext || !masterGain) return;
  const target = muted ? 0 : clampVolume(volume) * 0.9;
  try {
    masterGain.gain.setValueAtTime(target, audioContext.currentTime);
  } catch {
    // ignore
  }
}

// ---------------- public API ----------------

export function getAudioStatus(): AudioStatus {
  return audioStatus;
}

export function getAudioPreferences(): { muted: boolean; volume: number } {
  return { muted, volume };
}

export function setMuted(m: boolean): void {
  muted = !!m;
  savePrefs();
  applyMasterGain();
  devLog("setMuted", muted);
}

export function setVolume(v: number): void {
  volume = clampVolume(v);
  savePrefs();
  applyMasterGain();
  devLog("setVolume", volume);
}

/** Registers the sound to preload on the next unlock (no fetch delay on buzz). */
export function setPreferredSound(id: BuzzerSoundId): void {
  if (!isValidBuzzerSoundId(id)) return;
  preferredSoundId = id;
}

export async function unlockAudioFromUserGesture(): Promise<AudioUnlockResult> {
  if (!isAudioSupported()) {
    audioStatus = "unsupported";
    devWarn("unsupported: AudioContext not available");
    return { status: "unsupported", reason: "Web Audio API not supported" };
  }

  try {
    const Ctor = getAudioContextCtor();
    if (!Ctor) {
      audioStatus = "unsupported";
      return { status: "unsupported", reason: "AudioContext unavailable" };
    }

    if (!audioContext) {
      devLog("creating AudioContext (gesture)");
      audioContext = new Ctor();
      masterGain = audioContext.createGain();
      masterGain.gain.value = muted ? 0 : clampVolume(volume) * 0.9;
      masterGain.connect(audioContext.destination);
      devLog("AudioContext state after create:", audioContext.state);
    }

    if (audioContext.state === "suspended") {
      devLog("resuming AudioContext, before:", audioContext.state);
      await audioContext.resume();
      devLog("AudioContext state after resume:", audioContext.state);
    }

    if (audioContext.state === "running") {
      audioStatus = "ready";
      devLog("unlock ready");
      // Fire-and-forget preload of the preferred sound: the first buzz then
      // plays instantly from cache.
      void getSoundBuffer(preferredSoundId).catch((err) => {
        devWarn("preferred sound preload failed", err);
      });
      return { status: "ready" };
    } else {
      audioStatus = "blocked";
      devWarn("blocked: state=", audioContext.state);
      return { status: "blocked", reason: `AudioContext state: ${audioContext.state}` };
    }
  } catch (err) {
    audioStatus = "blocked";
    const msg = err instanceof Error ? err.message : String(err);
    devWarn("unlock blocked error", msg);
    return { status: "blocked", reason: msg };
  }
}

function ensureReadyForPlayback(): boolean {
  if (audioStatus !== "ready" || !audioContext || !masterGain) return false;
  if (audioContext.state !== "running") return false;
  if (muted) return false;
  return true;
}

/** Fetches + decodes an mp3 once; subsequent calls hit the cache. */
function getSoundBuffer(id: BuzzerSoundId): Promise<AudioBuffer> {
  if (!audioContext) return Promise.reject(new Error("AudioContext not ready"));
  const cached = bufferCache.get(id);
  if (cached) return Promise.resolve(cached);
  const pending = pendingDecodes.get(id);
  if (pending) return pending;
  const task = (async () => {
    try {
      const res = await fetch(buzzerSoundUrl(id));
      if (!res.ok) throw new Error(`Failed to load ${id}.mp3 (HTTP ${res.status})`);
      const raw = await res.arrayBuffer();
      const buf = await audioContext!.decodeAudioData(raw);
      bufferCache.set(id, buf);
      return buf;
    } finally {
      pendingDecodes.delete(id);
    }
  })();
  pendingDecodes.set(id, task);
  return task;
}

function playSoundBuffer(id: BuzzerSoundId): void {
  if (!audioContext || !masterGain) return;
  void getSoundBuffer(id)
    .then((buf) => {
      // Re-check at playback time: the user may have muted while decoding.
      if (!ensureReadyForPlayback()) {
        devLog("playback skipped after decode (muted/blocked)", id);
        return;
      }
      const src = audioContext!.createBufferSource();
      src.buffer = buf;
      src.connect(masterGain!);
      src.start();
      trackSource(src);
      devLog("played", id, `activeSources=${activeSources.size}`);
    })
    .catch((err) => {
      devWarn("playback error", id, err);
    });
}

export async function previewSound(id: BuzzerSoundId): Promise<void> {
  if (!isValidBuzzerSoundId(id)) {
    throw new Error(`Invalid buzzer sound id: ${String(id)}`);
  }
  // Preview is always triggered from a user gesture; ensure unlock first.
  if (audioStatus !== "ready") {
    const r = await unlockAudioFromUserGesture();
    if (r.status !== "ready") {
      devWarn("preview blocked", r);
      return;
    }
  }
  if (!ensureReadyForPlayback()) {
    devWarn("preview skipped: not ready/muted/blocked");
    return;
  }
  stopActiveSounds();
  playSoundBuffer(id);
}

export async function playWinnerSound(
  soundId: BuzzerSoundId,
  buzzEventKey: string,
): Promise<void> {
  // Dedup: at most once per tab per buzzEventKey
  if (processedEventKeys.has(buzzEventKey)) {
    devLog("playWinnerSound skipped duplicate", buzzEventKey);
    return;
  }
  processedEventKeys.add(buzzEventKey);

  const normalized = isValidBuzzerSoundId(soundId) ? soundId : DEFAULT_BUZZER_SOUND;

  if (muted) {
    devLog("playWinnerSound skipped: muted", buzzEventKey, normalized);
    return;
  }
  if (audioStatus !== "ready" || !audioContext || audioContext.state !== "running") {
    devLog("playWinnerSound skipped: not ready", buzzEventKey, `status=${audioStatus}`, `ctx=${audioContext?.state}`);
    return;
  }

  playSoundBuffer(normalized);
}

/** Mark an event as processed without playing (for initial snapshot / historical). */
export function markEventProcessed(buzzEventKey: string): void {
  processedEventKeys.add(buzzEventKey);
}

export function clearProcessedEventKeys(): void {
  processedEventKeys.clear();
  devLog("cleared processed keys");
}

export function stopActiveSounds(): void {
  const count = activeSources.size;
  for (const src of [...activeSources]) {
    try {
      src.stop();
    } catch {
      // already stopped
    }
    try {
      src.disconnect();
    } catch {
      // ignore
    }
  }
  activeSources.clear();
  devLog("stopActiveSounds", `stopped=${count}`);
}

export function disposeAudio(): void {
  stopActiveSounds();
  clearProcessedEventKeys();
  bufferCache.clear();
  if (audioContext) {
    try {
      // Do not await close to avoid blocking; fire-and-forget
      void audioContext.close().catch(() => {});
    } catch {
      // ignore
    }
    audioContext = null;
    masterGain = null;
  }
  audioStatus = "uninitialized";
  devLog("disposeAudio");
}

function trackSource(node: AudioScheduledSourceNode): void {
  activeSources.add(node);
  node.addEventListener("ended", () => {
    activeSources.delete(node);
    try {
      (node as unknown as { disconnect: () => void }).disconnect();
    } catch {
      // ignore
    }
  });
}

// For testing: expose internal helpers
export const __test__ = {
  clampVolume,
  isValidBuzzerSoundId,
};
