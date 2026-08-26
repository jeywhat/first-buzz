/**
 * Procedural buzzer audio — Web Audio API only, no assets.
 * One shared AudioContext per tab, lazy-created inside user gestures.
 *
 * Firebase stores only the tiny allowlisted profile id; every browser
 * synthesizes the sound locally and deterministically from that id.
 */

export const BUZZER_SOUND_PROFILES = [
  "classic-buzzer",
  "arcade-zap",
  "game-show-ding",
  "retro-blip",
  "synth-horn",
  "laser-pulse",
  "double-chime",
  "electric-pop",
] as const;

export type BuzzerSoundProfileId = (typeof BUZZER_SOUND_PROFILES)[number];

export type AudioStatus = "uninitialized" | "ready" | "blocked" | "unsupported";
export type AudioUnlockResult =
  | { status: "ready" }
  | { status: "blocked"; reason: string }
  | { status: "unsupported"; reason: string };

const PROFILE_SET = new Set<string>(BUZZER_SOUND_PROFILES as readonly string[]);

export function isValidSoundProfileId(v: unknown): v is BuzzerSoundProfileId {
  return typeof v === "string" && PROFILE_SET.has(v);
}

/** Deterministic default for a uid (stable across refreshes/clients). */
export function getDefaultSoundProfileId(userId: string): BuzzerSoundProfileId {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const idx = (h >>> 0) % BUZZER_SOUND_PROFILES.length;
  return BUZZER_SOUND_PROFILES[idx] as BuzzerSoundProfileId;
}

export function normalizeProfileId(
  v: unknown,
  fallbackUserId?: string,
): BuzzerSoundProfileId {
  if (isValidSoundProfileId(v)) return v;
  if (fallbackUserId) return getDefaultSoundProfileId(fallbackUserId);
  return "classic-buzzer";
}

// ---------------- internal state ----------------

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let audioStatus: AudioStatus = "uninitialized";
const processedEventKeys = new Set<string>();
const activeSources = new Set<AudioScheduledSourceNode>();

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
function clampFreq(f: number): number {
  return Math.min(20000, Math.max(20, f));
}
function clampGain(g: number): number {
  return Math.min(1, Math.max(0, g));
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
  const target = muted ? 0 : clampGain(volume) * 0.6; // safe ceiling 0.6
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
  if (import.meta.env.DEV) {
    // aria-live will be handled by UI; log only
  }
}

export function setVolume(v: number): void {
  volume = clampVolume(v);
  savePrefs();
  applyMasterGain();
  devLog("setVolume", volume);
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
      if (import.meta.env.DEV) devLog("creating AudioContext (gesture)");
      audioContext = new Ctor();
      masterGain = audioContext.createGain();
      masterGain.gain.value = muted ? 0 : clampGain(volume) * 0.6;
      masterGain.connect(audioContext.destination);
      devLog("AudioContext state after create:", audioContext.state);
    }

    if (audioContext.state === "suspended") {
      if (import.meta.env.DEV) devLog("resuming AudioContext, before:", audioContext.state);
      await audioContext.resume();
      devLog("AudioContext state after resume:", audioContext.state);
    }

    if (audioContext.state === "running") {
      audioStatus = "ready";
      devLog("unlock ready");
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

export async function previewSoundProfile(profileId: BuzzerSoundProfileId): Promise<void> {
  if (!isValidSoundProfileId(profileId)) {
    throw new Error(`Invalid profile id: ${String(profileId)}`);
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
  try {
    // Stop previous preview to avoid overlap, but keep event dedup separate
    stopActiveSounds();
    synthesizeProfile(profileId, `preview:${profileId}:${Date.now()}`);
    devLog("preview played", profileId);
  } catch (err) {
    devWarn("preview error", err);
  }
}

export async function playWinnerSound(
  profileId: BuzzerSoundProfileId,
  buzzEventKey: string,
): Promise<void> {
  const normalized = normalizeProfileId(profileId);
  // Dedup: at most once per tab per buzzEventKey
  if (processedEventKeys.has(buzzEventKey)) {
    devLog("playWinnerSound skipped duplicate", buzzEventKey);
    return;
  }
  processedEventKeys.add(buzzEventKey);

  if (!isValidSoundProfileId(normalized)) {
    devWarn("invalid profile, using fallback", profileId);
  }

  if (muted) {
    devLog("playWinnerSound skipped: muted", buzzEventKey, normalized);
    return;
  }
  if (audioStatus !== "ready" || !audioContext || audioContext.state !== "running") {
    devLog("playWinnerSound skipped: not ready", buzzEventKey, `status=${audioStatus}`, `ctx=${audioContext?.state}`);
    return;
  }

  try {
    synthesizeProfile(normalized, buzzEventKey);
    devLog("playWinnerSound played", buzzEventKey, normalized, `activeSources=${activeSources.size}`);
  } catch (err) {
    devWarn("playWinnerSound error", err, buzzEventKey);
  }
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

// ---------------- synthesis ----------------

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

function createGainEnvelope(ctx: AudioContext, master: GainNode): GainNode {
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  g.connect(master);
  return g;
}

function scheduleStop(
  _ctx: AudioContext,
  source: AudioScheduledSourceNode,
  gain: GainNode,
  stopTime: number,
): void {
  // Ensure gain reaches near zero before stop to avoid click
  try {
    gain.gain.setTargetAtTime(0.0001, stopTime - 0.02, 0.015);
  } catch {
    try {
      gain.gain.linearRampToValueAtTime(0.0001, stopTime);
    } catch {
      // ignore
    }
  }
  try {
    source.stop(stopTime);
  } catch {
    // ignore double-stop
  }
  trackSource(source);
}

function deterministicNoiseBuffer(
  ctx: AudioContext,
  durationSec: number,
  seedStr: string,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sampleRate * durationSec));
  const buf = ctx.createBuffer(1, len, sampleRate);
  const data = buf.getChannelData(0);
  // simple deterministic xorshift based on hash of seedStr
  let h = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let x = h >>> 0 || 1;
  for (let i = 0; i < len; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    // map to -1..1, scale down to keep transient soft
    data[i] = ((x >>> 0) / 0xffffffff) * 2 - 1;
  }
  return buf;
}

function synthClassicBuzzer(ctx: AudioContext, master: GainNode, t0: number): void {
  const osc = ctx.createOscillator();
  osc.type = "square";
  const gain = createGainEnvelope(ctx, master);
  osc.frequency.setValueAtTime(clampFreq(110), t0);
  // slight wobble
  osc.frequency.linearRampToValueAtTime(clampFreq(118), t0 + 0.08);
  osc.frequency.linearRampToValueAtTime(clampFreq(106), t0 + 0.18);
  osc.frequency.linearRampToValueAtTime(clampFreq(112), t0 + 0.32);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.55, t0 + 0.012);
  gain.gain.setValueAtTime(0.55, t0 + 0.3);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
  osc.connect(gain);
  osc.start(t0);
  scheduleStop(ctx, osc, gain, t0 + 0.45);
}

function synthArcadeZap(ctx: AudioContext, master: GainNode, t0: number): void {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const gain = createGainEnvelope(ctx, master);
  osc.frequency.setValueAtTime(clampFreq(900), t0);
  osc.frequency.exponentialRampToValueAtTime(clampFreq(180), t0 + 0.3);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.6, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
  osc.connect(gain);
  osc.start(t0);
  scheduleStop(ctx, osc, gain, t0 + 0.3);
}

function synthGameShowDing(ctx: AudioContext, master: GainNode, t0: number): void {
  const makeNote = (freq: number, start: number, dur: number): void => {
    const o = ctx.createOscillator();
    o.type = "sine";
    const g = createGainEnvelope(ctx, master);
    o.frequency.setValueAtTime(clampFreq(freq), start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(0.5, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g);
    o.start(start);
    scheduleStop(ctx, o, g, start + dur);
    // second harmonic faint triangle
    const o2 = ctx.createOscillator();
    o2.type = "triangle";
    const g2 = createGainEnvelope(ctx, master);
    o2.frequency.setValueAtTime(clampFreq(freq * 2), start);
    g2.gain.setValueAtTime(0.0001, start);
    g2.gain.linearRampToValueAtTime(0.12, start + 0.012);
    g2.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o2.connect(g2);
    o2.start(start);
    scheduleStop(ctx, o2, g2, start + dur);
  };
  makeNote(440, t0, 0.18);
  makeNote(659, t0 + 0.2, 0.22);
}

function synthRetroBlip(ctx: AudioContext, master: GainNode, t0: number): void {
  const osc = ctx.createOscillator();
  osc.type = "square";
  const gain = createGainEnvelope(ctx, master);
  osc.frequency.setValueAtTime(clampFreq(200), t0);
  osc.frequency.setValueAtTime(clampFreq(750), t0 + 0.06);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.5, t0 + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
  osc.connect(gain);
  osc.start(t0);
  scheduleStop(ctx, osc, gain, t0 + 0.22);
}

function synthSynthHorn(ctx: AudioContext, master: GainNode, t0: number): void {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1800, t0);
  filter.Q.value = 0.7;
  filter.connect(master);

  const mk = (type: OscillatorType, detune: number): { osc: OscillatorNode; gain: GainNode } => {
    const o = ctx.createOscillator();
    o.type = type;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(filter);
    o.frequency.setValueAtTime(clampFreq(150), t0);
    o.frequency.linearRampToValueAtTime(clampFreq(148), t0 + 0.6);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.32, t0 + 0.02);
    g.gain.linearRampToValueAtTime(0.28, t0 + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.62);
    o.connect(g);
    return { osc: o, gain: g };
  };
  const a = mk("sawtooth", -6);
  const b = mk("square", 7);
  a.osc.start(t0);
  b.osc.start(t0);
  scheduleStop(ctx, a.osc, a.gain, t0 + 0.62);
  scheduleStop(ctx, b.osc, b.gain, t0 + 0.62);
}

function synthLaserPulse(ctx: AudioContext, master: GainNode, t0: number, seed: string): void {
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  const gain = createGainEnvelope(ctx, master);
  osc.frequency.setValueAtTime(clampFreq(1200), t0);
  osc.frequency.exponentialRampToValueAtTime(clampFreq(140), t0 + 0.32);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.55, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
  osc.connect(gain);
  osc.start(t0);
  scheduleStop(ctx, osc, gain, t0 + 0.32);

  // subtle noise burst at onset (deterministic)
  try {
    const buf = deterministicNoiseBuffer(ctx, 0.04, `laser:${seed}`);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const ng = createGainEnvelope(ctx, master);
    // bandpass-ish via highpass? keep simple: low gain
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.linearRampToValueAtTime(0.18, t0 + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    src.connect(ng);
    src.start(t0);
    scheduleStop(ctx, src, ng, t0 + 0.05);
  } catch {
    // ignore noise failure
  }
}

function synthDoubleChime(ctx: AudioContext, master: GainNode, t0: number): void {
  const mk = (freq: number, start: number): void => {
    const o = ctx.createOscillator();
    o.type = "triangle";
    const g = createGainEnvelope(ctx, master);
    o.frequency.setValueAtTime(clampFreq(freq), start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(0.45, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
    o.connect(g);
    o.start(start);
    scheduleStop(ctx, o, g, start + 0.17);
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    const g2 = createGainEnvelope(ctx, master);
    o2.frequency.setValueAtTime(clampFreq(freq * 1.5), start);
    g2.gain.setValueAtTime(0.0001, start);
    g2.gain.linearRampToValueAtTime(0.11, start + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
    o2.connect(g2);
    o2.start(start);
    scheduleStop(ctx, o2, g2, start + 0.17);
  };
  mk(600, t0);
  mk(800, t0 + 0.12);
}

function synthElectricPop(ctx: AudioContext, master: GainNode, t0: number, seed: string): void {
  const osc = ctx.createOscillator();
  osc.type = "square";
  const gain = createGainEnvelope(ctx, master);
  osc.frequency.setValueAtTime(clampFreq(180), t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.6, t0 + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
  osc.connect(gain);
  osc.start(t0);
  scheduleStop(ctx, osc, gain, t0 + 0.09);

  // tiny deterministic noise transient
  try {
    const buf = deterministicNoiseBuffer(ctx, 0.025, `pop:${seed}`);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const ng = createGainEnvelope(ctx, master);
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.linearRampToValueAtTime(0.22, t0 + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
    src.connect(ng);
    src.start(t0);
    scheduleStop(ctx, src, ng, t0 + 0.03);
  } catch {
    // ignore
  }

  // second tail blip
  const osc2 = ctx.createOscillator();
  osc2.type = "square";
  const g2 = createGainEnvelope(ctx, master);
  osc2.frequency.setValueAtTime(clampFreq(90), t0 + 0.08);
  g2.gain.setValueAtTime(0.0001, t0 + 0.08);
  g2.gain.linearRampToValueAtTime(0.3, t0 + 0.085);
  g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
  osc2.connect(g2);
  osc2.start(t0 + 0.08);
  scheduleStop(ctx, osc2, g2, t0 + 0.24);
}

function synthesizeProfile(profileId: BuzzerSoundProfileId, seed: string): void {
  if (!audioContext || !masterGain) throw new Error("AudioContext not ready");
  const ctx = audioContext;
  const master = masterGain;
  const t0 = ctx.currentTime + 0.015; // tiny lookahead to avoid glitch
  switch (profileId) {
    case "classic-buzzer":
      synthClassicBuzzer(ctx, master, t0);
      break;
    case "arcade-zap":
      synthArcadeZap(ctx, master, t0);
      break;
    case "game-show-ding":
      synthGameShowDing(ctx, master, t0);
      break;
    case "retro-blip":
      synthRetroBlip(ctx, master, t0);
      break;
    case "synth-horn":
      synthSynthHorn(ctx, master, t0);
      break;
    case "laser-pulse":
      synthLaserPulse(ctx, master, t0, seed);
      break;
    case "double-chime":
      synthDoubleChime(ctx, master, t0);
      break;
    case "electric-pop":
      synthElectricPop(ctx, master, t0, seed);
      break;
    default:
      synthClassicBuzzer(ctx, master, t0);
      break;
  }
}

// For testing: expose internal helpers (DEV only)
export const __test__ = {
  clampVolume,
  clampFreq,
  isValidSoundProfileId,
};
