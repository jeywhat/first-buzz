import { describe, expect, it } from "vitest";
import {
  BUZZER_SOUNDS,
  BUZZER_SOUND_LABELS,
  DEFAULT_BUZZER_SOUND,
  buzzerSoundLabel,
  buzzerSoundUrl,
  isValidBuzzerSoundId,
} from "./buzzer-sounds";

describe("buzzer sound catalog", () => {
  it("exposes exactly 31 unique sound ids", () => {
    expect(BUZZER_SOUNDS.length).toBe(31);
    expect(new Set(BUZZER_SOUNDS).size).toBe(31);
  });

  it("defaults to the Voice Chair choice button sound", () => {
    expect(DEFAULT_BUZZER_SOUND).toBe("the-voicechair-choice-button-sound");
    expect(isValidBuzzerSoundId(DEFAULT_BUZZER_SOUND)).toBe(true);
  });

  it("validates allowlisted ids and rejects everything else", () => {
    expect(isValidBuzzerSoundId("bruh")).toBe(true);
    expect(isValidBuzzerSoundId("error_song")).toBe(true);
    expect(isValidBuzzerSoundId("classic-buzzer")).toBe(false); // legacy procedural id
    expect(isValidBuzzerSoundId("../secret")).toBe(false);
    expect(isValidBuzzerSoundId(42)).toBe(false);
    expect(isValidBuzzerSoundId(null)).toBe(false);
  });

  it("builds asset URLs under /sound_effects", () => {
    expect(buzzerSoundUrl("bruh")).toBe("/sound_effects/bruh.mp3");
    expect(buzzerSoundUrl(DEFAULT_BUZZER_SOUND)).toBe(
      "/sound_effects/the-voicechair-choice-button-sound.mp3",
    );
  });

  it("derives readable labels (suffix tokens stripped, first letter up)", () => {
    expect(buzzerSoundLabel("nani_-meme-sound-effect")).toBe("Nani meme");
    expect(buzzerSoundLabel("kids-saying-yay-sound-effect")).toBe("Kids saying yay");
    expect(buzzerSoundLabel("the-voicechair-choice-button-sound")).toBe(
      "The voicechair choice button",
    );
    expect(buzzerSoundLabel("bruh")).toBe("Bruh");
    expect(buzzerSoundLabel("error_song")).toBe("Error song");
  });

  it("provides a label for every catalog id", () => {
    for (const id of BUZZER_SOUNDS) {
      expect(BUZZER_SOUND_LABELS[id]).toBeTruthy();
    }
  });
});
