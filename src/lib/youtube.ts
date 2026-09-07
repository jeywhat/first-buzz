/** YouTube video IDs are exactly 11 chars of [A-Za-z0-9_-]. */
export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/* ------------------------------------------------------------------ */
/*  Local video volume (YouTube IFrame API range: 0..100)              */
/* ------------------------------------------------------------------ */

/** Step size for the volume up/down controls. */
export const VOLUME_STEP = 10;
export const MIN_VOLUME = 0;
export const MAX_VOLUME = 100;

/** Clamps any value into the YT API's 0..100 volume range (integers). */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return MAX_VOLUME;
  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, Math.round(value)));
}

/** Applies a signed step to a current volume, clamped to 0..100. */
export function stepVolume(current: number, delta: number): number {
  return clampVolume(clampVolume(current) + delta);
}

const PATH_PREFIXES = ["embed", "shorts", "live", "v"];

function stripHostPrefixes(hostname: string): string {
  return hostname.replace(/^(www|m|music)\./i, "").toLowerCase();
}

/**
 * Extracts the 11-character videoId from usual YouTube URL shapes:
 *  - youtube.com/watch?v=<id>            (with any extra parameters)
 *  - youtu.be/<id>                       (with any extra parameters)
 *  - youtube.com/embed/<id>
 *  - youtube.com/shorts/<id>, /live/<id>, /v/<id>
 * A bare 11-character ID is accepted as a convenience.
 * Returns null for anything unrecognized.
 */
export function extractVideoId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (VIDEO_ID_PATTERN.test(value)) return value;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  // youtu.be short links: first path segment is the id.
  if (stripHostPrefixes(parsed.hostname) === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    return VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  const host = stripHostPrefixes(parsed.hostname);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    // watch?v=<id> — parameters may appear in any order around it.
    const vParam = parsed.searchParams.get("v");
    if (vParam && VIDEO_ID_PATTERN.test(vParam)) return vParam;

    // Path-style URLs: /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>.
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (
      segments.length >= 2 &&
      segments[0] !== undefined &&
      PATH_PREFIXES.includes(segments[0].toLowerCase())
    ) {
      const id = segments[1] ?? "";
      if (VIDEO_ID_PATTERN.test(id)) return id;
    }
  }

  return null;
}
