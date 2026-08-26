import { describe, it, expect } from "vitest";
import {
  sortByPosition,
  resolveQueueView,
  findQueuedDuplicate,
  computeMovePatch,
  pickNextLaunchTarget,
  isRemovable,
  buildPlayerQueueSummary,
  validateQueueDraft,
} from "./queue";
import type { QueueItem } from "./queue";

function item(id: string, videoId: string, position: number, addedAt = 1000): QueueItem {
  return { id, videoId, title: null, addedAt, addedBy: "host", position };
}

describe("sortByPosition", () => {
  it("sorts by position then addedAt then id", () => {
    const a = item("a", "AAA11111111", 2);
    const b = item("b", "BBB11111111", 1);
    const c = item("c", "CCC11111111", 2, 900);
    const sorted = [a, b, c].sort(sortByPosition);
    expect(sorted.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
});

describe("resolveQueueView (legacy compatibility adapter)", () => {
  it("returns empty view when no queue and no legacy video", () => {
    const v = resolveQueueView(null, null);
    expect(v.items).toHaveLength(0);
    expect(v.active).toBeNull();
    expect(v.activeIsLegacy).toBe(false);
  });

  it("synthesizes ONE active item for a legacy room with only /video.videoId", () => {
    const v = resolveQueueView(null, "dQw4w9WgXcQ");
    expect(v.items).toHaveLength(1);
    expect(v.active?.videoId).toBe("dQw4w9WgXcQ");
    expect(v.active?.id.startsWith("legacy-")).toBe(true);
    expect(v.activeIsLegacy).toBe(true);
  });

  it("does NOT corrupt data: synthetic item exists in memory only", () => {
    const v = resolveQueueView(undefined, "abc123XYZ_-");
    // Round-trip: writing back v would produce nothing durable — no queue node.
    expect(v.revision).toBe(0);
    expect(v.items[0]?.title).toBeNull();
  });

  it("hybrid room: legacy active pinned first, real items queued after", () => {
    const snap = {
      items: { x: item("x", "XXXXXXXXXXX", 0) },
      activeItemId: null,
      revision: 3,
    };
    const v = resolveQueueView(snap, "LEGACYVID1");
    expect(v.active?.id.startsWith("legacy-")).toBe(true);
    expect(v.items.map((i) => i.id)).toEqual(["legacy-LEGACYVID1", "x"]);
    expect(v.revision).toBe(3);
  });

  it("uses stored activeItemId once a real launch happened (legacy gone)", () => {
    const snap = {
      items: {
        x: item("x", "XXXXXXXXXXX", 0),
        y: item("y", "YYYYYYYYYYY", 1),
      },
      activeItemId: "y",
      revision: 5,
    };
    const v = resolveQueueView(snap, "OLDOLDVID1");
    expect(v.activeIsLegacy).toBe(false);
    expect(v.active?.videoId).toBe("YYYYYYYYYYY");
  });
});

describe("findQueuedDuplicate", () => {
  it("detects case-insensitive duplicates", () => {
    const items = [item("a", "AAAAAAAAAAA", 0)];
    expect(findQueuedDuplicate(items, "aaaaaaaaaaa")).not.toBeNull();
    expect(findQueuedDuplicate(items, "BBBBBBBBBBB")).toBeNull();
  });
});

describe("computeMovePatch", () => {
  const q = [item("a", "AAAAAAAAAAA", 0), item("b", "BBBBBBBBBBB", 1), item("c", "CCCCCCCCCCC", 2)];

  it("swaps exactly two positions on up", () => {
    const patch = computeMovePatch(q, "b", "up");
    expect(patch).toEqual({ b: { position: 0 }, a: { position: 1 } });
  });
  it("swaps exactly two positions on down", () => {
    const patch = computeMovePatch(q, "a", "down");
    expect(patch).toEqual({ a: { position: 1 }, b: { position: 0 } });
  });
  it("is a no-op at boundaries", () => {
    expect(computeMovePatch(q, "a", "up")).toEqual({});
    expect(computeMovePatch(q, "c", "down")).toEqual({});
  });
  it("unknown id returns empty patch", () => {
    expect(computeMovePatch(q, "zzz", "up")).toEqual({});
  });
});

describe("pickNextLaunchTarget", () => {
  const q = [item("a", "AAAAAAAAAAA", 0), item("b", "BBBBBBBBBBB", 1), item("c", "CCCCCCCCCCC", 2)];

  it("no items → null", () => {
    expect(pickNextLaunchTarget([], null)).toBeNull();
  });
  it("none active → first queued", () => {
    expect(pickNextLaunchTarget(q, null)?.id).toBe("a");
  });
  it("active unknown → first queued", () => {
    expect(pickNextLaunchTarget(q, "gone")?.id).toBe("a");
  });
  it("middle → next one", () => {
    expect(pickNextLaunchTarget(q, "b")?.id).toBe("c");
  });
  it("end of queue → null (never auto-wraps/autoplays)", () => {
    expect(pickNextLaunchTarget(q, "c")).toBeNull();
  });
});

describe("isRemovable / removal guard", () => {
  const it_ = item("a", "AAAAAAAAAAA", 0);
  it("active item cannot be removed", () => {
    expect(isRemovable(it_, "a")).toBe(false);
  });
  it("non-active item can be removed", () => {
    expect(isRemovable(it_, "other")).toBe(true);
  });
});

describe("buildPlayerQueueSummary", () => {
  const view = resolveQueueView(
    {
      items: Object.fromEntries(
        ["a", "b", "c", "d", "e", "f"].map((id, i) => [id, item(id, `${id}111111111`.slice(0, 11), i)]),
      ),
      activeItemId: "b",
      revision: 1,
    },
    null,
  );

  it("shows active + next N + remaining count", () => {
    const s = buildPlayerQueueSummary(view, 3);
    expect(s.active?.id).toBe("b");
    expect(s.upcoming.map((x) => x.id)).toEqual(["c", "d", "e"]);
    expect(s.remainingAfterShown).toBe(1); // f
  });
});

describe("validateQueueDraft", () => {
  it("rejects empty input", () => {
    expect(validateQueueDraft("   ", [], { allowDuplicate: false }).ok).toBe(false);
  });
  it("accepts full watch URL, shorts, youtu.be and bare id", () => {
    const urls = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "dQw4w9WgXcQ",
    ];
    for (const u of urls) {
      const r = validateQueueDraft(u, [], { allowDuplicate: false });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.draft.videoId).toBe("dQw4w9WgXcQ");
        expect(r.draft.position).toBe(0);
        expect(r.draft.id).not.toBe("");
      }
    }
  });
  it("rejects invalid video ids and non-YouTube URLs", () => {
    expect(validateQueueDraft("https://vimeo.com/123", [], { allowDuplicate: false }).ok).toBe(false);
    expect(validateQueueDraft("watch?v=short!", [], { allowDuplicate: false }).ok).toBe(false);
  });
  it("flags duplicate unless explicitly allowed", () => {
    const existing = [item("q1", "dQw4w9WgXcQ", 0)];
    const dup = validateQueueDraft("youtu.be/dQw4w9WgXcQ", existing, { allowDuplicate: false });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBe("duplicate");
    const allowed = validateQueueDraft("youtu.be/dQw4w9WgXcQ", existing, { allowDuplicate: true });
    expect(allowed.ok).toBe(true);
  });
});
