/**
 * Local media compatibility service — CLIENT-ONLY.
 *
 * HARD RULES:
 *  - This module NEVER imports Firebase and NEVER writes to the database.
 *    Global room truth (playback status, seq, videoSessionId, round, scores,
 *    queue, presence) stays exactly where it is; this service only receives
 *    READ-ONLY snapshots of the authoritative playback state.
 *  - It never replaces the desktop-compatible path. For "desktop-compatible"
 *    clients it is fully transparent: it records nothing user-visible and
 *    shows no unlock UI, no matter what (muted audio, paused room, small
 *    viewport, late join, no prior click).
 *  - Only "restricted-media" clients with an ACTUAL observed local block
 *    (YouTube autoplay blocked / player state mismatch / suspended
 *    AudioContext) surface a local "Tap to start" control, driven exclusively
 *    by a trusted user gesture. No retry loops, no polling.
 *  - Video and audio failure handling are independent: one can succeed while
 *    the other stays locked.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ClientMediaMode = "desktop-compatible" | "restricted-media";

export type LocalVideoPlaybackState =
  | "unknown"
  | "autoplay-attempting"
  | "playing"
  | "paused"
  | "blocked-needs-gesture"
  | "failed";

export type LocalAudioPlaybackState =
  | "unknown"
  | "ready"
  | "locked-needs-gesture"
  | "muted"
  | "failed";

export type LocalMediaBlockReason =
  | "none"
  | "youtube-autoplay-blocked"
  | "player-state-mismatch"
  | "audio-context-suspended"
  | "audio-resume-rejected"
  | "unsupported"
  | "unknown";

export interface LocalMediaCompatibilityState {
  mode: ClientMediaMode;
  video: LocalVideoPlaybackState;
  audio: LocalAudioPlaybackState;
  localUnlockRequired: boolean;
  localUnlockVisible: boolean;
  /** True when video is fine but game sounds still need a gesture. */
  audioHintVisible: boolean;
  lastBlockReason: LocalMediaBlockReason;
  /** Transient success note shown once after a successful local unlock. */
  lastUnlockSucceeded: boolean;
}

/** Read-only projection of the authoritative playback state. */
export interface AuthoritativePlaybackState {
  playing: boolean;
  videoId: string;
  seq: number;
}

export interface LocalMediaUnlockResult {
  video: "ok" | "pending" | "failed" | "not-needed";
  audio: "ok" | "failed";
}

/**
 * Environment facts used for mode detection — injectable for tests.
 * NOTE: viewport width is deliberately NOT a signal.
 */
export interface LocalMediaEnv {
  userAgent: string;
  maxTouchPoints: number;
  coarsePointer: boolean;
}

export function defaultLocalMediaEnv(): LocalMediaEnv {
  return {
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    maxTouchPoints: typeof navigator !== "undefined" ? navigator.maxTouchPoints ?? 0 : 0,
    coarsePointer:
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches,
  };
}

const RESTRICTED_UA_RE =
  /iPhone|iPad|iPod|Android|Mobile|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile/i;

/**
 * Mode detection. Restricted = touch-first / mobile-identified browsers,
 * which are far more likely to require a user gesture for media. This is a
 * PROBABILITY signal only: restricted clients still try the normal automatic
 * path first and stay transparent when it succeeds.
 */
export function detectClientMediaMode(env: LocalMediaEnv = defaultLocalMediaEnv()): ClientMediaMode {
  const touchDevice = env.coarsePointer && env.maxTouchPoints > 0;
  const mobileUa = RESTRICTED_UA_RE.test(env.userAgent);
  // iPadOS 13+ masquerades as desktop Safari but reports Macintosh + touch.
  const iPadOs =
    /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1 && env.coarsePointer;
  return touchDevice || mobileUa || iPadOs ? "restricted-media" : "desktop-compatible";
}

/* ------------------------------------------------------------------ */
/*  Service factory                                                    */
/* ------------------------------------------------------------------ */

/**
 * Adapter invoked ONLY from a trusted user gesture (the unlock control's
 * click/touch handler). Implemented in main.ts with the EXISTING local
 * player handle and the EXISTING audio unlock — no second player, no second
 * AudioContext, no Firebase.
 */
export interface LocalMediaAdapter {
  /** Resume the existing Web Audio context (existing service). */
  resumeAudio(): Promise<"ok" | "failed">;
  /**
   * One-shot local sync of the EXISTING YouTube player: seek to the
   * authoritative position, then play/pause ONCE per the snapshot.
   */
  syncVideo(playback: AuthoritativePlaybackState): void;
}

export interface LocalMediaCompatibilityService {
  handleAuthoritativePlayback(playback: Readonly<AuthoritativePlaybackState>): void;
  handleYouTubeAutoplayBlocked(): void;
  handleYouTubePlayerStateChange(playerState: number): void;
  noteAudioStatus(audioStatus: string): void;
  unlockLocalMediaFromTrustedGesture(): Promise<LocalMediaUnlockResult>;
  getLocalMediaCompatibilityState(): LocalMediaCompatibilityState;
  getLatestPlayback(): Readonly<AuthoritativePlaybackState> | null;
  subscribe(listener: (state: LocalMediaCompatibilityState) => void): () => void;
}

/** YT.PlayerState values (numeric to avoid depending on the YT global here). */
const YT_UNSTARTED = -1;
const YT_ENDED = 0;
const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_BUFFERING = 3;
const YT_CUED = 5;

export function createLocalMediaCompatibilityService(
  adapter: LocalMediaAdapter,
  env: LocalMediaEnv = defaultLocalMediaEnv(),
): LocalMediaCompatibilityService {
  const mode = detectClientMediaMode(env);

  let video: LocalVideoPlaybackState = "unknown";
  let audio: LocalAudioPlaybackState = "unknown";
  let localUnlockRequired = false;
  let localUnlockVisible = false;
  let lastBlockReason: LocalMediaBlockReason = "none";
  let lastUnlockSucceeded = false;
  let latestPlayback: AuthoritativePlaybackState | null = null;
  let unlockInFlight = false;
  const listeners = new Set<(state: LocalMediaCompatibilityState) => void>();

  function snapshot(): LocalMediaCompatibilityState {
    return {
      mode,
      video,
      audio,
      localUnlockRequired,
      localUnlockVisible,
      // Compact "Enable game sounds" hint: only restricted clients whose
      // video is fine but whose Web Audio still needs a gesture.
      audioHintVisible:
        mode === "restricted-media" &&
        (audio === "locked-needs-gesture" || audio === "unknown") &&
        (video === "playing" || video === "autoplay-attempting"),
      lastBlockReason,
      lastUnlockSucceeded,
    };
  }

  function emit(): void {
    const s = snapshot();
    for (const l of listeners) l(s);
  }

  function setVideoState(next: LocalVideoPlaybackState): void {
    if (video === next) return;
    video = next;
    emit();
  }

  function showUnlock(reason: LocalMediaBlockReason): void {
    if (mode !== "restricted-media") return; // desktop: never
    localUnlockRequired = true;
    localUnlockVisible = true;
    lastBlockReason = reason;
    emit();
  }

  function hideUnlock(): void {
    const changed = localUnlockVisible || localUnlockRequired || lastUnlockSucceeded;
    localUnlockRequired = false;
    localUnlockVisible = false;
    lastUnlockSucceeded = false;
    if (changed) emit();
  }

  /* ---------------- authoritative playback (read-only) ---------------- */

  function handleAuthoritativePlayback(playback: Readonly<AuthoritativePlaybackState>): void {
    latestPlayback = { ...playback };
    if (mode !== "restricted-media") {
      // DESKTOP-COMPATIBLE: fully transparent. The existing sync flow runs
      // untouched; this service records nothing and shows nothing.
      return;
    }
    if (!playback.videoId) return; // idle room — nothing to play locally
    if (playback.playing) {
      // The existing player path already attempted local playback once.
      // Success/failure arrives via state-change / blocked events.
      setVideoState("autoplay-attempting");
    } else {
      setVideoState("paused");
      // Global pause: an unlock gate would be wrong here.
      if (!unlockInFlight) hideUnlock();
    }
  }

  /* ---------------- observed local player outcomes ---------------- */

  function handleYouTubeAutoplayBlocked(): void {
    if (mode !== "restricted-media") {
      // Defensive: desktop never surfaces the gate; record only.
      lastBlockReason = "youtube-autoplay-blocked";
      return;
    }
    setVideoState("blocked-needs-gesture");
    showUnlock("youtube-autoplay-blocked");
  }

  function handleYouTubePlayerStateChange(playerState: number): void {
    if (mode !== "restricted-media") return; // desktop: transparent
    if (playerState === YT_PLAYING || playerState === YT_BUFFERING) {
      // Local playback confirmed — the gate becomes unnecessary instantly.
      lastBlockReason = "none";
      setVideoState("playing");
      hideUnlock();
      return;
    }
    if (playerState === YT_PAUSED || playerState === YT_ENDED) {
      setVideoState("paused");
      return;
    }
    if (playerState === YT_UNSTARTED || playerState === YT_CUED) {
      // Not proof of a block on its own — the blocked check decides.
      if (video === "playing") setVideoState("unknown");
    }
  }

  /* ---------------- audio (independent of video) ---------------- */

  function noteAudioStatus(audioStatus: string): void {
    if (mode !== "restricted-media") return; // desktop: keep existing behavior
    const prev = audio;
    switch (audioStatus) {
      case "ready":
        audio = "ready";
        break;
      case "blocked":
        audio = "locked-needs-gesture";
        break;
      case "unsupported":
        audio = "failed";
        break;
      default:
        audio = "unknown";
    }
    if (prev !== audio) emit();
  }

  /* ---------------- trusted-gesture unlock ---------------- */

  async function unlockLocalMediaFromTrustedGesture(): Promise<LocalMediaUnlockResult> {
    if (mode !== "restricted-media" || unlockInFlight) {
      return { video: "not-needed", audio: "ok" };
    }
    unlockInFlight = true;
    // Assigned before any read (the catch path returns early on failure).
    let audioOk: boolean;
    try {
      // AUDIO first, synchronously within the gesture (existing service,
      // existing single AudioContext — no new one).
      const audioRes = await adapter.resumeAudio();
      audioOk = audioRes === "ok";
      audio = audioOk ? "ready" : "locked-needs-gesture";
      emit();

      const pb = latestPlayback;
      if (!pb || !pb.videoId) {
        // Nothing authoritative to sync to — audio alone is still unlocked.
        if (!pb?.playing) hideUnlock();
        return { video: "not-needed", audio: audioOk ? "ok" : "failed" };
      }

      // VIDEO: one local seek (+ play/pause once). No loop, no retry —
      // confirmation arrives via handleYouTubePlayerStateChange.
      adapter.syncVideo(pb);
      if (pb.playing) {
        setVideoState("autoplay-attempting");
        // Keep the gate visible until PLAYING confirms; if it never does,
        // the control stays for another deliberate tap (no auto-retry).
        return { video: "pending", audio: audioOk ? "ok" : "failed" };
      }
      // Authoritative paused: gesture only unlocks audio + re-seeks locally.
      setVideoState("paused");
      hideUnlock();
      return { video: "not-needed", audio: audioOk ? "ok" : "failed" };
    } catch {
      audio = "failed";
      emit();
      return { video: "failed", audio: "failed" };
    } finally {
      unlockInFlight = false;
    }
  }

  /* ---------------- public surface ---------------- */

  return {
    handleAuthoritativePlayback,
    handleYouTubeAutoplayBlocked,
    handleYouTubePlayerStateChange,
    noteAudioStatus,
    unlockLocalMediaFromTrustedGesture,
    getLocalMediaCompatibilityState: snapshot,
    getLatestPlayback: () => latestPlayback,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };
}
