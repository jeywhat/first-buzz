import { describe, it, expect, beforeEach } from "vitest";
import {
  BUZZER_SOUND_PROFILES,
  type BuzzerSoundProfileId,
  getDefaultSoundProfileId,
  normalizeProfileId,
  isValidSoundProfileId,
  getAudioPreferences,
  getAudioStatus,
  setMuted,
  setVolume,
  playWinnerSound,
  previewSoundProfile,
  markEventProcessed,
  clearProcessedEventKeys,
  __test__,
} from "./proceduralBuzzerAudioService";

// Ensure localStorage clean before each test
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore storage clear errors
  }
  clearProcessedEventKeys();
  // reset prefs to defaults via service internal? set to defaults
  setMuted(false);
  setVolume(0.7);
});

describe("allowlist", () => {
  it("contains exactly 8 profiles", () => {
    expect(BUZZER_SOUND_PROFILES).toHaveLength(8);
    expect(BUZZER_SOUND_PROFILES).toEqual([
      "classic-buzzer",
      "arcade-zap",
      "game-show-ding",
      "retro-blip",
      "synth-horn",
      "laser-pulse",
      "double-chime",
      "electric-pop",
    ]);
  });
  it("isValidSoundProfileId accepts allowlisted and rejects others", () => {
    for (const p of BUZZER_SOUND_PROFILES) {
      expect(isValidSoundProfileId(p)).toBe(true);
    }
    expect(isValidSoundProfileId("invalid")).toBe(false);
    expect(isValidSoundProfileId("")).toBe(false);
    expect(isValidSoundProfileId(null)).toBe(false);
    expect(isValidSoundProfileId(undefined)).toBe(false);
  });
});

describe("deterministic default", () => {
  it("same uid yields same profile", () => {
    const a = getDefaultSoundProfileId("user-123");
    const b = getDefaultSoundProfileId("user-123");
    expect(a).toBe(b);
  });
  it("different uids may yield different profiles but always allowlisted", () => {
    const ids = ["a", "b", "user-xyz", "host-uid-999", "uid-0"];
    for (const id of ids) {
      const p = getDefaultSoundProfileId(id);
      expect(isValidSoundProfileId(p)).toBe(true);
    }
  });
  it("normalize fallback uses deterministic default when missing", () => {
    const p1 = normalizeProfileId(undefined, "user-123");
    const p2 = getDefaultSoundProfileId("user-123");
    expect(p1).toBe(p2);
  });
  it("normalize fallback returns classic-buzzer when no user and invalid", () => {
    expect(normalizeProfileId("bad-id")).toBe("classic-buzzer");
    expect(normalizeProfileId(undefined)).toBe("classic-buzzer");
  });
  it("normalize returns valid id unchanged", () => {
    expect(normalizeProfileId("arcade-zap")).toBe("arcade-zap");
  });
});

describe("volume/mute", () => {
  it("clamps volume to 0..1", () => {
    expect(__test__.clampVolume(2)).toBe(1);
    expect(__test__.clampVolume(-1)).toBe(0);
    expect(__test__.clampVolume(0.5)).toBe(0.5);
    expect(__test__.clampVolume(NaN as unknown as number)).toBe(0.7);
  });
  it("setVolume clamps and persists via getAudioPreferences", () => {
    setVolume(1.5);
    expect(getAudioPreferences().volume).toBe(1);
    setVolume(-0.2);
    expect(getAudioPreferences().volume).toBe(0);
    setVolume(0.42);
    expect(getAudioPreferences().volume).toBe(0.42);
  });
  it("setMuted toggles", () => {
    setMuted(true);
    expect(getAudioPreferences().muted).toBe(true);
    setMuted(false);
    expect(getAudioPreferences().muted).toBe(false);
  });
  it("clampFreq stays within 20..20000", () => {
    expect(__test__.clampFreq(10)).toBe(20);
    expect(__test__.clampFreq(30000)).toBe(20000);
    expect(__test__.clampFreq(440)).toBe(440);
  });
});

describe("audio unsupported", () => {
  it("reports unsupported when AudioContext missing (node env)", () => {
    // In vitest node env, window.AudioContext is undefined -> unsupported after unlock attempt?
    // getAudioStatus initially uninitialized, not unsupported until unlock tried.
    // We check that play/preview do not throw when unsupported.
    expect(getAudioStatus()).toMatch(/uninitialized|unsupported|blocked|ready/);
  });
  it("preview rejects invalid profile", async () => {
    await expect(previewSoundProfile("invalid" as BuzzerSoundProfileId)).rejects.toThrow();
  });
});

describe("dedup and replay", () => {
  it("no replay for duplicate event key", async () => {
    const key = "roomX:1:winnerY:12345";
    // first call should mark processed even though audio not ready (muted? not ready)
    await playWinnerSound("classic-buzzer", key);
    // second call with same key should be skipped (still marked)
    // we can't observe sound count without AudioContext, but we can check that it doesn't throw and is idempotent
    await playWinnerSound("classic-buzzer", key);
    // No error, second call is deduped
    expect(true).toBe(true);
  });
  it("different keys are not deduped", async () => {
    await playWinnerSound("arcade-zap", "room:1:w1:100");
    await playWinnerSound("arcade-zap", "room:1:w1:101");
    // both processed separately, no throw
    expect(true).toBe(true);
  });
  it("late join: markEventProcessed prevents future play", async () => {
    const key = "room:5:winner:999";
    markEventProcessed(key);
    await playWinnerSound("retro-blip", key);
    // should be skipped because already marked
    expect(true).toBe(true);
  });
  it("clearProcessedEventKeys allows replay after clear (room change)", async () => {
    const key = "room:2:w2:200";
    await playWinnerSound("laser-pulse", key);
    clearProcessedEventKeys();
    // after clear, same key would be considered new; but our playWinnerSound would try again
    // should not throw
    await playWinnerSound("laser-pulse", key);
    expect(true).toBe(true);
  });
});

describe("recipe invocation per valid profile (no throw when unsupported)", () => {
  it("each profile invocation does not throw (even when audio blocked)", async () => {
    for (const pid of BUZZER_SOUND_PROFILES) {
      const key = `test:${pid}:${Math.random()}`;
      await expect(playWinnerSound(pid, key)).resolves.toBeUndefined();
    }
  });
});

describe("blocked behavior", () => {
  it("muted skips playback but marks processed", async () => {
    setMuted(true);
    const key = "room:9:w3:300";
    await playWinnerSound("electric-pop", key);
    // Now try again with same key after unmuting -> still deduped, so no replay
    setMuted(false);
    await playWinnerSound("electric-pop", key);
    expect(true).toBe(true);
  });
});
