import type { UserId } from "../../types/common";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Small, deterministic skin-tone palette (no external assets). */
const SKIN_TONES = ["#f1c9a5", "#e0ac86", "#c68642", "#8d5524", "#5c3a21", "#ffdbac"];

/**
 * Deterministic 32-bit hash (FNV-1a) of the userId. The same userId always
 * yields the same seed on every client and refresh, so avatars are stable.
 */
export function getStableAvatarSeed(userId: UserId): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface GeneratedAvatarHandles {
  root: HTMLElement;
}

/**
 * Builds a stylized, deterministic SVG avatar from a seed + player color.
 * No Canvas/WebGL/external images. The player color is reused as the clothing
 * and hair accent so the avatar stays visually tied to the player's identity.
 */
export function createGeneratedAvatar(opts: {
  seed: number;
  color: string;
  name: string;
}): GeneratedAvatarHandles {
  const { seed, color, name } = opts;

  const root = document.createElement("div");
  root.className = "vb-avatar";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "vb-avatar__svg");
  svg.setAttribute("aria-hidden", "true");

  const faceShape = seed % 3;
  const hairStyle = (seed >> 4) % 5;
  const skinTone = SKIN_TONES[(seed >> 8) % SKIN_TONES.length] ?? "#f1c9a5";

  // Shoulders / clothing — player color.
  const body = document.createElementNS(SVG_NS, "path");
  body.setAttribute("d", "M18 100 Q18 68 50 68 Q82 68 82 100 Z");
  body.setAttribute("fill", color);
  svg.append(body);

  // Head — deterministic shape + skin tone.
  const head = document.createElementNS(SVG_NS, "ellipse");
  if (faceShape === 0) {
    head.setAttribute("cx", "50");
    head.setAttribute("cy", "42");
    head.setAttribute("rx", "22");
    head.setAttribute("ry", "22");
  } else if (faceShape === 1) {
    head.setAttribute("cx", "50");
    head.setAttribute("cy", "44");
    head.setAttribute("rx", "24");
    head.setAttribute("ry", "21");
  } else {
    head.setAttribute("cx", "50");
    head.setAttribute("cy", "42");
    head.setAttribute("rx", "20");
    head.setAttribute("ry", "23");
  }
  head.setAttribute("fill", skinTone);
  svg.append(head);

  // Hair / hat — player color accent (compatible with identity color).
  const hair = document.createElementNS(SVG_NS, "path");
  hair.setAttribute("fill", color);
  switch (hairStyle) {
    case 0: // bald — no hair
      break;
    case 1: // cap
      hair.setAttribute("d", "M28 40 Q50 18 72 40 Q50 30 28 40 Z");
      break;
    case 2: // full
      hair.setAttribute(
        "d",
        "M26 42 Q26 16 50 16 Q74 16 74 42 Q60 28 50 28 Q40 28 26 42 Z",
      );
      break;
    case 3: // mohawk
      hair.setAttribute("d", "M46 42 L46 12 L54 12 L54 42 Z");
      break;
    default: // hat
      hair.setAttribute("d", "M24 30 L76 30 L72 14 L28 14 Z");
      break;
  }
  if (hairStyle !== 0) svg.append(hair);

  // Eyes.
  const eyeL = document.createElementNS(SVG_NS, "circle");
  eyeL.setAttribute("cx", "42");
  eyeL.setAttribute("cy", "40");
  eyeL.setAttribute("r", "2.4");
  eyeL.setAttribute("fill", "#1c1c1c");
  const eyeR = document.createElementNS(SVG_NS, "circle");
  eyeR.setAttribute("cx", "58");
  eyeR.setAttribute("cy", "40");
  eyeR.setAttribute("r", "2.4");
  eyeR.setAttribute("fill", "#1c1c1c");
  svg.append(eyeL, eyeR);

  // Mouth.
  const mouth = document.createElementNS(SVG_NS, "path");
  mouth.setAttribute("d", "M42 52 Q50 58 58 52");
  mouth.setAttribute("stroke", "#1c1c1c");
  mouth.setAttribute("stroke-width", "2");
  mouth.setAttribute("fill", "none");
  mouth.setAttribute("stroke-linecap", "round");
  svg.append(mouth);

  root.append(svg);

  // Initials fallback — always visible, also covers tiny renders.
  const initials = document.createElement("span");
  initials.className = "vb-avatar__initials";
  initials.setAttribute("aria-hidden", "true");
  initials.textContent = getInitials(name);
  root.append(initials);

  return { root };
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase();
}
