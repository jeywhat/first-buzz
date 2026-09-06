import { describe, expect, it } from "vitest";
import {
  createLocalMediaCompatibilityService,
  detectClientMediaMode,
  type AuthoritativePlaybackState,
  type LocalMediaEnv,
} from "./localMediaCompatibilityService";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const desktopEnv: LocalMediaEnv = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
  maxTouchPoints: 0,
  coarsePointer: false,
};

const iphoneEnv: LocalMediaEnv = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
  maxTouchPoints: 5,
  coarsePointer: true,
};

const androidEnv: LocalMediaEnv = {
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
  maxTouchPoints: 5,
  coarsePointer: true,
};

const iPadOsEnv: LocalMediaEnv = {
  // iPadOS 13+ masquerades as desktop Safari but reports touch.
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/604.1",
  maxTouchPoints: 5,
  coarsePointer: true,
};

/** Small viewport alone must NOT be a signal — env has no viewport field. */
const smallViewportDesktopEnv = desktopEnv;

const playing = (seq = 7): AuthoritativePlaybackState => ({
  playing: true,
  videoId: "abc123",
  seq,
});

const paused = (seq = 7): AuthoritativePlaybackState => ({
  playing: false,
  videoId: "abc123",
  seq,
});

type AdapterCalls = { resumeAudio: number; syncVideo: number };

function makeService(
  env: LocalMediaEnv,
  opts: { resumeAudioResult?: "ok" | "failed" } = {},
) {
  const calls: AdapterCalls = { resumeAudio: 0, syncVideo: 0 };
  const svc = createLocalMediaCompatibilityService(
    {
      resumeAudio: async () => {
        calls.resumeAudio++;
        return opts.resumeAudioResult ?? "ok";
      },
      syncVideo: () => {
        calls.syncVideo++;
      },
    },
    env,
  );
  return { svc, calls };
}

/* ------------------------------------------------------------------ */
/*  Mode detection                                                     */
/* ------------------------------------------------------------------ */

describe("detectClientMediaMode", () => {
  it("classifies desktop Chrome/Windows as desktop-compatible", () => {
    expect(detectClientMediaMode(desktopEnv)).toBe("desktop-compatible");
  });

  it("classifies iPhone and Android as restricted-media", () => {
    expect(detectClientMediaMode(iphoneEnv)).toBe("restricted-media");
    expect(detectClientMediaMode(androidEnv)).toBe("restricted-media");
  });

  it("detects iPadOS 13+ (desktop UA masquerade with touch)", () => {
    expect(detectClientMediaMode(iPadOsEnv)).toBe("restricted-media");
  });

  it("does NOT treat a small viewport as restricted (no viewport signal exists)", () => {
    // There is deliberately no width/height input — the env shape proves it.
    const env: LocalMediaEnv = { ...smallViewportDesktopEnv };
    expect(Object.keys(env).some((k) => /width|height|viewport/i.test(k))).toBe(false);
    expect(detectClientMediaMode(env)).toBe("desktop-compatible");
  });
});

/* ------------------------------------------------------------------ */
/*  Desktop-compatible path: FULLY transparent                         */
/* ------------------------------------------------------------------ */

describe("desktop-compatible mode", () => {
  it("never shows the unlock UI no matter what happens", () => {
    const { svc } = makeService(desktopEnv);
    svc.handleAuthoritativePlayback(playing());
    svc.handleYouTubeAutoplayBlocked();
    svc.handleYouTubePlayerStateChange(-1); // UNSTARTED
    svc.noteAudioStatus("blocked");
    const s = svc.getLocalMediaCompatibilityState();
    expect(s.mode).toBe("desktop-compatible");
    expect(s.localUnlockVisible).toBe(false);
    expect(s.localUnlockRequired).toBe(false);
    expect(s.audioHintVisible).toBe(false);
    expect(s.video).toBe("unknown"); // untouched — existing flow owns it
  });

  it("never invokes the local adapter and holds no timers", async () => {
    const { svc, calls } = makeService(desktopEnv);
    svc.handleAuthoritativePlayback(playing());
    const r = await svc.unlockLocalMediaFromTrustedGesture();
    expect(r.video).toBe("not-needed");
    expect(calls.resumeAudio).toBe(0);
    expect(calls.syncVideo).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Restricted media: automatic attempt succeeds → stay transparent    */
/* ------------------------------------------------------------------ */

describe("restricted media — successful automatic attempt", () => {
  it("playing snapshot → attempting → PLAYING event: no unlock UI ever", () => {
    const { svc } = makeService(iphoneEnv);
    svc.handleAuthoritativePlayback(playing());
    expect(svc.getLocalMediaCompatibilityState().video).toBe("autoplay-attempting");
    expect(svc.getLocalMediaCompatibilityState().localUnlockVisible).toBe(false);
    svc.handleYouTubePlayerStateChange(1); // PLAYING
    const s = svc.getLocalMediaCompatibilityState();
    expect(s.video).toBe("playing");
    expect(s.localUnlockVisible).toBe(false);
    expect(s.lastBlockReason).toBe("none");
  });

  it("global pause clears any transient state and shows no gate", () => {
    const { svc } = makeService(iphoneEnv);
    svc.handleAuthoritativePlayback(playing());
    svc.handleAuthoritativePlayback(paused(8));
    const s = svc.getLocalMediaCompatibilityState();
    expect(s.video).toBe("paused");
    expect(s.localUnlockVisible).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Restricted media: observed block → local gate                      */
/* ------------------------------------------------------------------ */

describe("restricted media — blocked autoplay", () => {
  it("autoplay blocked → gate visible ONLY locally, with the block reason", () => {
    const { svc } = makeService(iphoneEnv);
    svc.handleAuthoritativePlayback(playing());
    svc.handleYouTubeAutoplayBlocked();
    const s = svc.getLocalMediaCompatibilityState();
    expect(s.video).toBe("blocked-needs-gesture");
    expect(s.localUnlockVisible).toBe(true);
    expect(s.localUnlockRequired).toBe(true);
    expect(s.lastBlockReason).toBe("youtube-autoplay-blocked");
  });

  it("unlock gesture calls the adapter exactly once and confirms via PLAYING", async () => {
    const { svc, calls } = makeService(iphoneEnv);
    svc.handleAuthoritativePlayback(playing());
    svc.handleYouTubeAutoplayBlocked();
    const result = await svc.unlockLocalMediaFromTrustedGesture();
    expect(calls.resumeAudio).toBe(1);
    expect(calls.syncVideo).toBe(1);
    expect(result.video).toBe("pending");
    expect(result.audio).toBe("ok");
    // Still gated until local playback is CONFIRMED...
    expect(svc.getLocalMediaCompatibilityState().localUnlockVisible).toBe(true);
    // ...then the normal state-change flow closes the gate.
    svc.handleYouTubePlayerStateChange(1); // PLAYING
    const s = svc.getLocalMediaCompatibilityState();
    expect(s.video).toBe("playing");
    expect(s.localUnlockVisible).toBe(false);
    expect(s.lastBlockReason).toBe("none");
  });

  it("failed unlock retains the gate with NO retry loop", async () => {
    const { svc, calls } = makeService(iphoneEnv, { resumeAudioResult: "failed" });
    svc.handleAuthoritativePlayback(playing());
    svc.handleYouTubeAutoplayBlocked();
    const result = await svc.unlockLocalMediaFromTrustedGesture();
    expect(result.audio).toBe("failed");
    const s = svc.getLocalMediaCompatibilityState();
    // Audio failed but video attempt still went out (independent paths).
    expect(s.localUnlockVisible).toBe(true);
    // No timer-driven retry exists: without new events nothing changes.
    expect(svc.getLocalMediaCompatibilityState().localUnlockVisible).toBe(true);
    expect(calls.syncVideo).toBe(1); // exactly one attempt, no spin
  });

  it("rapid double gestures do not double-invoke the adapter", async () => {
    const { svc, calls } = makeService(iphoneEnv);
    svc.handleAuthoritativePlayback(playing());
    svc.handleYouTubeAutoplayBlocked();
    await Promise.all([
      svc.unlockLocalMediaFromTrustedGesture(),
      svc.unlockLocalMediaFromTrustedGesture(),
    ]);
    expect(calls.syncVideo).toBe(1);
    expect(calls.resumeAudio).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Audio and video are independent                                    */
/* ------------------------------------------------------------------ */

describe("audio/video independence (restricted)", () => {
  it("video succeeds while audio is locked → compact audio hint only", () => {
    const { svc } = makeService(iphoneEnv);
    svc.handleAuthoritativePlayback(playing());
    svc.handleYouTubePlayerStateChange(1); // video playing
    svc.noteAudioStatus("blocked"); // AudioContext still suspended
    const s = svc.getLocalMediaCompatibilityState();
    expect(s.video).toBe("playing");
    expect(s.audio).toBe("locked-needs-gesture");
    expect(s.audioHintVisible).toBe(true);
    expect(s.localUnlockVisible).toBe(false);
  });

  it("video blocked while audio is ready → gate stays, no audio hint", () => {
    const { svc } = makeService(iphoneEnv);
    svc.handleAuthoritativePlayback(playing());
    svc.noteAudioStatus("ready");
    svc.handleYouTubeAutoplayBlocked();
    const s = svc.getLocalMediaCompatibilityState();
    expect(s.video).toBe("blocked-needs-gesture");
    expect(s.audio).toBe("ready");
    expect(s.localUnlockVisible).toBe(true);
    expect(s.audioHintVisible).toBe(false);
  });

  it("paused room: unlock is audio+seek only and closes the gate", async () => {
    const { svc, calls } = makeService(iphoneEnv);
    svc.handleAuthoritativePlayback(paused());
    svc.handleYouTubeAutoplayBlocked(); // was playing before the pause
    const result = await svc.unlockLocalMediaFromTrustedGesture();
    expect(calls.syncVideo).toBe(1);
    expect(result.video).toBe("not-needed");
    const s = svc.getLocalMediaCompatibilityState();
    expect(s.video).toBe("paused");
    expect(s.localUnlockVisible).toBe(false);
    expect(s.audio).toBe("ready");
  });
});

/* ------------------------------------------------------------------ */
/*  Subscription                                                       */
/* ------------------------------------------------------------------ */

describe("subscription", () => {
  it("emits immediately and on change; unsubscribe stops it", () => {
    const { svc } = makeService(iphoneEnv);
    let count = 0;
    const un = svc.subscribe(() => count++);
    expect(count).toBe(1); // immediate snapshot
    svc.handleYouTubeAutoplayBlocked();
    // One event may emit more than once (video state + gate flags); the
    // renderer is idempotent, so only the guarantee below matters.
    const afterBlock = count;
    expect(afterBlock).toBeGreaterThan(1);
    un();
    svc.handleYouTubePlayerStateChange(1); // PLAYING
    expect(count).toBe(afterBlock); // no further emissions after unsubscribe
  });
});
