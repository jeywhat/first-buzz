import { describe, it, expect } from "vitest";
import { calculateArenaGeometry } from "./arena-geometry";

interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
}

/** Station rect from a placement (badge allowance 8px included). */
function stationRect(p: { x: number; y: number }, w: number, h: number): Box {
  const hh = h / 2 + 8;
  return { l: p.x - w / 2, r: p.x + w / 2, t: p.y - hh, b: p.y + hh };
}

const hit = (a: Box, b: Box): boolean =>
  a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

/** Full collision contract for a geometry result. */
function expectNoCollisions(
  geo: ReturnType<typeof calculateArenaGeometry>,
  stationW: number,
  stationH: number,
  coreW: number,
  coreH: number,
  input: { width: number; height: number; statusH: number; feedbackH: number },
): void {
  const rects = geo.placements.map((p) => stationRect(p, stationW, stationH));
  const core: Box = {
    l: geo.centerX - coreW / 2 - 12,
    r: geo.centerX + coreW / 2 + 12,
    t: geo.centerY - coreH / 2 - 12,
    b: geo.centerY + coreH / 2 + 12,
  };
  for (const r of rects) {
    expect(hit(r, core)).toBe(false);
    expect(r.t).toBeGreaterThanOrEqual(input.statusH + 4);
    expect(r.b).toBeLessThanOrEqual(input.height - input.feedbackH - 4);
    expect(r.l).toBeGreaterThanOrEqual(4);
    expect(r.r).toBeLessThanOrEqual(input.width - 4);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(hit(rects[i]!, rects[j]!)).toBe(false);
    }
  }
}

/** Measured anchored-compact station (trigger 40px + score, avatar 30). */
const ANCHORED = { stationW: 76, stationH: 92 };
const CORE_NARROW = { coreW: 84, coreH: 84 }; // 30cqw floor at 282 stage

function narrow(width: number, height: number, playerCount: number, coreW = 84, coreH = 84) {
  return calculateArenaGeometry({
    width,
    height,
    statusH: 46,
    feedbackH: 26,
    coreW,
    coreH,
    ...ANCHORED,
    playerCount,
  });
}

describe("calculateArenaGeometry — measured anchored stations", () => {
  it("420×420 (1024/768 viewports), 8 players: ring or columns, collision-free, ≥4", () => {
    const geo = narrow(420, 420, 8, 100, 100);
    expect(geo.placements.length).toBeGreaterThanOrEqual(4);
    expectNoCollisions(geo, ANCHORED.stationW, ANCHORED.stationH, 100, 100, {
      width: 420,
      height: 420,
      statusH: 46,
      feedbackH: 26,
    });
  });

  it("420×420, 6 players: collision-free", () => {
    const geo = narrow(420, 420, 6, 100, 100);
    expect(geo.placements.length).toBeGreaterThanOrEqual(4);
    expectNoCollisions(geo, ANCHORED.stationW, ANCHORED.stationH, 100, 100, {
      width: 420,
      height: 420,
      statusH: 46,
      feedbackH: 26,
    });
  });

  it("282×282 (1280/1440 viewports), 6 players: ≥2 visible, collision-free", () => {
    const geo = narrow(282, 282, 6);
    expect(geo.mode).toBe("columns");
    expect(geo.placements.length).toBeGreaterThanOrEqual(2);
    expectNoCollisions(geo, ANCHORED.stationW, ANCHORED.stationH, CORE_NARROW.coreW, CORE_NARROW.coreH, {
      width: 282,
      height: 282,
      statusH: 46,
      feedbackH: 26,
    });
  });

  it("282×282, 12 players: capped visible, overflow reported, collision-free", () => {
    const geo = narrow(282, 282, 12);
    expect(geo.mode).toBe("columns");
    expect(geo.placements.length + geo.overflow).toBe(12);
    expectNoCollisions(geo, ANCHORED.stationW, ANCHORED.stationH, CORE_NARROW.coreW, CORE_NARROW.coreH, {
      width: 282,
      height: 282,
      statusH: 46,
      feedbackH: 26,
    });
  });

  it("332×332 (390×844 mobile), 6 players: ≥4 visible, collision-free", () => {
    const geo = narrow(332, 332, 6, 99.6, 99.6);
    expect(geo.placements.length).toBeGreaterThanOrEqual(4);
    expectNoCollisions(geo, ANCHORED.stationW, ANCHORED.stationH, 99.6, 99.6, {
      width: 332,
      height: 332,
      statusH: 46,
      feedbackH: 26,
    });
  });

  it("200×200: nothing fits → list mode, all overflow", () => {
    const geo = narrow(200, 200, 6);
    expect(geo.mode).toBe("list");
    expect(geo.overflow).toBe(6);
  });

  it("deterministic: identical input → identical output", () => {
    const a = narrow(282, 282, 6);
    const b = narrow(282, 282, 6);
    expect(a).toEqual(b);
  });
});
