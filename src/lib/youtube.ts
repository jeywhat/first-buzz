/** YouTube video IDs are exactly 11 chars of [A-Za-z0-9_-]. */
export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

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
