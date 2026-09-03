/**
 * Deterministic collision-safe geometry for the circular Player Arena.
 *
 * Pure function — takes MEASURED sizes (stage box, central core, one player
 * station) and returns a mode plus per-station positions:
 *  - "ring":    stations on an ellipse around the central buzzer (rotation
 *               offset candidates avoid dead axes);
 *  - "columns": stations in left/right columns flanking the buzzer;
 *  - "list":    nothing fits → hide podiums, rely on the full list (+N).
 *
 * Collision rules baked in:
 *  - the central core is inflated by `centerGap` — no station rect may enter;
 *  - accepted stations keep `stationGap` clearance from each other;
 *  - every station sits fully inside the playable band between the status
 *    zone (top) and the feedback zone (bottom), with `pad` side margins;
 *  - station half-height includes a badge allowance (YOU / FIRST overhang).
 * The caller walks a size ladder (cozy → compact) and re-invokes; this
 * function is deterministic: same inputs → same mode/placements.
 */

export type ArenaMode = "ring" | "columns" | "list";

export interface ArenaGeometryInput {
  /** Stage box (the orbit container), in px. */
  width: number;
  height: number;
  /** Measured height of the top status zone (winner card / paused pill). */
  statusH: number;
  /** Measured height of the bottom feedback zone (status line). */
  feedbackH: number;
  /** Measured central core (BUZZ button), in px. */
  coreW: number;
  coreH: number;
  /** Measured player station bounding box (avatar + plate), in px. */
  stationW: number;
  stationH: number;
  playerCount: number;
  /** Outer safe padding inside the stage. Default 4. */
  pad?: number;
  /** Min gap between a station and the inflated core. Default 12. */
  centerGap?: number;
  /** Min gap between neighboring stations. Default 12. */
  stationGap?: number;
}

export interface ArenaPlacement {
  /** Index into the stable player order. */
  index: number;
  /** Station center, in stage coordinates (px). */
  x: number;
  y: number;
}

export interface ArenaGeometry {
  mode: ArenaMode;
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  placements: ArenaPlacement[];
  /** How many players are not shown (→ "+N" chip). */
  overflow: number;
}

interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
}

const hit = (a: Box, b: Box): boolean =>
  a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

const OFFSETS = [30, 0, 15, 45];

export function calculateArenaGeometry(input: ArenaGeometryInput): ArenaGeometry {
  const pad = input.pad ?? 4;
  const centerGap = input.centerGap ?? 12;
  const stationGap = input.stationGap ?? 12;
  const badgeAllow = 8;

  const hw = input.stationW / 2;
  const hh = input.stationH / 2 + badgeAllow;

  const availTop = input.statusH + pad;
  const availBottom = Math.max(availTop, input.height - input.feedbackH - pad);
  const availH = Math.max(0, availBottom - availTop);

  const cx = input.width / 2;
  const cy = availTop + availH / 2;

  const core: Box = {
    l: cx - input.coreW / 2 - centerGap,
    r: cx + input.coreW / 2 + centerGap,
    t: cy - input.coreH / 2 - centerGap,
    b: cy + input.coreH / 2 + centerGap,
  };

  const rx = Math.max(0, cx - pad - hw);
  const ry = Math.max(0, cy - hh - availTop);

  const n = Math.max(1, input.playerCount);
  const placements: ArenaPlacement[] = [];
  let mode: ArenaMode = "list";

  if (n >= 1 && rx > 0 && ry > 0) {
    // Rotation-offset candidates: a station must not land on a tight axis.
    for (const offsetDeg of OFFSETS) {
      const attempt: ArenaPlacement[] = [];
      for (let i = 0; i < n; i++) {
        const theta = ((offsetDeg - 90 + (360 / n) * i) * Math.PI) / 180;
        const x = cx + rx * Math.cos(theta);
        const y = cy + ry * Math.sin(theta);
        const rect: Box = { l: x - hw, r: x + hw, t: y - hh, b: y + hh };
        if (rect.l < pad || rect.r > input.width - pad || rect.t < availTop || rect.b > availBottom) {
          break;
        }
        if (hit(rect, core)) break;
        let neighbor = false;
        for (const q of attempt) {
          const qRect: Box = {
            l: q.x - hw - stationGap,
            r: q.x + hw + stationGap,
            t: q.y - hh - stationGap,
            b: q.y + hh + stationGap,
          };
          if (hit(rect, qRect)) {
            neighbor = true;
            break;
          }
        }
        if (neighbor) break;
        attempt.push({ index: i, x, y });
      }
      if (attempt.length === n) {
        placements.push(...attempt);
        mode = "ring";
        break;
      }
      if (attempt.length > placements.length) {
        placements.length = 0;
        placements.push(...attempt);
      }
    }
    // A ring with at least 2 placed stations is a usable partial result;
    // the caller's size ladder decides whether columns place more.
    if (mode === "ring" && placements.length >= 2) {
      return {
        mode,
        centerX: cx,
        centerY: cy,
        radiusX: rx,
        radiusY: ry,
        placements,
        overflow: n - placements.length,
      };
    }
  }

  // Columns fallback: left/right stacks flanking the core. Vertical rhythm
  // rowStep = stationH + badgeAllow + 8 guarantees adjacent rects (incl.
  // badge overhang) never touch; rows span the full playable band.
  const colWidth = (input.width - input.coreW - 3 * centerGap) / 2;
  if (n >= 2 && input.stationW <= colWidth) {
    const rowStep = input.stationH + badgeAllow + 8;
    const firstCenter = availTop + hh;
    const lastCenter = availBottom - hh;
    const k = Math.max(1, Math.floor((lastCenter - firstCenter) / rowStep) + 1);
    const visible = Math.min(n, 2 * k);
    const colX = [pad + hw, input.width - pad - hw];
    const placements: ArenaPlacement[] = [];
    const rects: Box[] = [];
    for (let i = 0; i < visible; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = colX[col]!;
      const y = availTop + hh + row * rowStep;
      const rect: Box = { l: x - hw, r: x + hw, t: y - hh, b: y + hh };
      if (hit(rect, core)) continue;
      let neighbor = false;
      for (const q of rects) {
        if (hit(rect, q)) {
          neighbor = true;
          break;
        }
      }
      if (neighbor) continue;
      rects.push(rect);
      placements.push({ index: i, x, y });
    }
    if (placements.length >= 2) {
      return {
        mode: "columns",
        centerX: cx,
        centerY: cy,
        radiusX: 0,
        radiusY: 0,
        placements,
        overflow: n - placements.length,
      };
    }
  }

  return {
    mode: "list",
    centerX: cx,
    centerY: cy,
    radiusX: 0,
    radiusY: 0,
    placements: [],
    overflow: n,
  };
}

export interface ArenaCandidate<T extends string> {
  size: T;
  controls?: string;
  geo: ArenaGeometry;
}

/**
 * Size-ladder selection: the caller measures each size class (cozy/compact)
 * and passes the resulting geometry; this picks the layout showing the most
 * players, preferring ring over columns and cozy over compact on ties.
 */
export function selectBestGeometry<T extends string>(
  candidates: ArenaCandidate<T>[],
): ArenaCandidate<T> | null {
  let best: { size: T; geo: ArenaGeometry } | null = null;
  for (const c of candidates) {
    if (!best) {
      best = c;
      continue;
    }
    const a = c.geo;
    const b = best.geo;
    if (a.placements.length !== b.placements.length) {
      if (a.placements.length > b.placements.length) best = c;
      continue;
    }
    const rank = (m: ArenaMode): number => (m === "ring" ? 1 : 0);
    if (rank(a.mode) !== rank(b.mode)) {
      if (rank(a.mode) > rank(b.mode)) best = c;
      continue;
    }
    if (c.size === "cozy" && best.size !== "cozy") best = c;
  }
  return best;
}
