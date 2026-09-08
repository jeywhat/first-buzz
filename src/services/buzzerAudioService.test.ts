import { beforeEach, describe, expect, it } from "vitest";
import {
  __test__,
  clearProcessedEventKeys,
  getAudioPreferences,
  markEventProcessed,
  playWinnerSound,
  setMuted,
  setPreferredSound,
  setVolume,
} from "./buzzerAudioService";
import { DEFAULT_BUZZER_SOUND } from "../lib/buzzer-sounds";

/* Node env: no AudioContext → playback paths skip gracefully, which is
   exactly what these tests assert (dedup, mute gate, invalid-id fallback). */

beforeEach(() => {
  clearProcessedEventKeys();
  setMuted(false);
  setVolume(0.7);
});

describe("preferences", () => {
  it("clamps volume to 0..1 and persists via getAudioPreferences", () => {
    setVolume(2);
    expect(getAudioPreferences().volume).toBe(1);
    setVolume(-1);
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
});

describe("dedup and replay", () => {
  it("plays at most once per buzz event key (skips when not ready)", async () => {
    // Not ready in node env → skipped, but the key is still marked processed.
    await playWinnerSound(DEFAULT_BUZZER_SOUND, "room:1:w1:100");
    await playWinnerSound(DEFAULT_BUZZER_SOUND, "room:1:w1:100");
    // No throw, no double processing — second call hits the dedup set.
  });

  it("different keys are not deduped", async () => {
    await playWinnerSound(DEFAULT_BUZZER_SOUND, "room:1:w1:100");
    await playWinnerSound(DEFAULT_BUZZER_SOUND, "room:1:w1:101");
  });

  it("markEventProcessed prevents future play", async () => {
    const key = "room:5:winner:999";
    markEventProcessed(key);
    await playWinnerSound(DEFAULT_BUZZER_SOUND, key);
  });

  it("clearProcessedEventKeys allows replay after clear (room change)", async () => {
    const key = "room:2:w2:200";
    await playWinnerSound(DEFAULT_BUZZER_SOUND, key);
    clearProcessedEventKeys();
    await playWinnerSound(DEFAULT_BUZZER_SOUND, key);
  });
});

describe("gates", () => {
  it("muted skips playback but marks processed", async () => {
    setMuted(true);
    await playWinnerSound(DEFAULT_BUZZER_SOUND, "room:9:w3:300");
    // replay attempt is deduped, not re-gated
    await playWinnerSound(DEFAULT_BUZZER_SOUND, "room:9:w3:300");
  });

  it("invalid sound id falls back to the factory default without throwing", async () => {
    await expect(
      playWinnerSound("not-a-sound" as never, "room:3:w4:400"),
    ).resolves.toBeUndefined();
  });
});

describe("internal helpers", () => {
  it("clampVolume stays within 0..1", () => {
    expect(__test__.clampVolume(-5)).toBe(0);
    expect(__test__.clampVolume(0.5)).toBe(0.5);
    expect(__test__.clampVolume(5)).toBe(1);
    expect(__test__.clampVolume(Number.NaN)).toBe(0.7);
  });

  it("isValidBuzzerSoundId mirrors the catalog", () => {
    expect(__test__.isValidBuzzerSoundId(DEFAULT_BUZZER_SOUND)).toBe(true);
    expect(__test__.isValidBuzzerSoundId("classic-buzzer")).toBe(false);
  });

  it("setPreferredSound ignores invalid ids", () => {
    expect(() => setPreferredSound("nope" as never)).not.toThrow();
  });
});
