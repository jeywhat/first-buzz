/**
 * Buzzer sound catalog — the 31 mp3 assets in /public/sound_effects.
 *
 * A sound "id" is the asset filename WITHOUT the .mp3 extension. Ids are
 * allowlisted below (never derived from user input) so they can be stored
 * safely in RTDB and validated by security rules.
 */

export const BUZZER_SOUNDS = [
  "anime-ahh",
  "anime-ahhhh",
  "bruh",
  "cite-de-la-peur-combien",
  "correct",
  "dinosaur-rawr",
  "error_song",
  "fahhh",
  "frank-leboeuf",
  "gunshotjbudden",
  "haaland-song",
  "jai-envie-que-il-me-defonce-le-minotaure",
  "kids-saying-yay-sound-effect",
  "mamaduh-diablo-selos",
  "maro-jump-sound-effect",
  "michael-jackson-hee-hee",
  "nani_-meme-sound-effect",
  "ouais-cest-greg",
  "perfect-fart",
  "pew-pew-lame-sound-effect",
  "proute",
  "punch-gaming-sound-effect",
  "shocked-sound-effect",
  "the-voicechair-choice-button-sound",
  "totally-spies",
  "tut-tut-grosse-pu-e",
  "undertakers-bell",
  "wrong-answer-sound-effect",
  "yoooo",
  "yoshi-tongue",
  "zemmour-tousse",
] as const;

export type BuzzerSoundId = (typeof BUZZER_SOUNDS)[number];

/** Factory default for every player until they pick their own. */
export const DEFAULT_BUZZER_SOUND: BuzzerSoundId =
  "the-voicechair-choice-button-sound";

const SOUND_SET = new Set<string>(BUZZER_SOUNDS as readonly string[]);

export function isValidBuzzerSoundId(v: unknown): v is BuzzerSoundId {
  return typeof v === "string" && SOUND_SET.has(v);
}

/** Public asset URL for a sound id. */
export function buzzerSoundUrl(id: BuzzerSoundId): string {
  return `/sound_effects/${id}.mp3`;
}

/** Trailing tokens stripped from filenames when deriving a readable label. */
const LABEL_SUFFIX_TOKENS = new Set(["sound", "effect", "effects"]);

/** Derives a readable label from the filename: "nani_-meme-sound-effect" → "Nani meme". */
export function buzzerSoundLabel(id: BuzzerSoundId): string {
  const tokens = id.split(/[-_]+/).filter(Boolean);
  while (tokens.length > 1 && LABEL_SUFFIX_TOKENS.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  const text = tokens.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Prebaked id → label map (stable order for <select> options). */
export const BUZZER_SOUND_LABELS: Record<BuzzerSoundId, string> = Object.fromEntries(
  BUZZER_SOUNDS.map((id) => [id, buzzerSoundLabel(id)]),
) as Record<BuzzerSoundId, string>;
