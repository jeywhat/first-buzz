// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { renderParticipantList } from "./participant-list";
import type { ParticipantView } from "../../types/participant";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function player(overrides: Partial<ParticipantView> = {}): ParticipantView {
  return {
    uid: overrides.uid ?? "u1",
    name: overrides.name ?? "Alice",
    color: "#ff4b72",
    score: overrides.score ?? 0,
    presenceState: overrides.presenceState ?? "online",
    isHost: overrides.isHost ?? false,
    joinedAt: overrides.joinedAt ?? 1000,
  };
}

interface Fixture {
  root: HTMLElement;
  calls: Array<{ uid: string; delta: number }>;
  gate: { release: (() => void) | null };
  set(list: ParticipantView[]): void;
}

function mount(opts: { isHost: boolean; uid?: string }): Fixture {
  const calls: Fixture["calls"] = [];
  const gate: Fixture["gate"] = { release: null };
  const handles = renderParticipantList({
    uid: opts.uid ?? "u1",
    isHost: opts.isHost,
    onAdjust: (target, delta) => {
      calls.push({ uid: target.uid, delta });
      return new Promise<void>((resolve) => {
        gate.release = () => resolve();
      });
    },
  });
  document.body.append(handles.root);
  return {
    root: handles.root,
    calls,
    gate,
    set: handles.setParticipants,
  };
}

function rowsOf(f: Fixture): HTMLElement[] {
  return Array.from(f.root.querySelectorAll<HTMLElement>(".vb-player-row"));
}

/** Drains the then/catch/finally microtask chain of a released promise. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

afterEach(() => {
  document.body.replaceChildren();
});

/* ------------------------------------------------------------------ */
/*  Row structure                                                      */
/* ------------------------------------------------------------------ */

describe("host player rows", () => {
  it("places − LEFT of the name and + RIGHT of the score", () => {
    const f = mount({ isHost: true });
    f.set([player({ uid: "u1", name: "Alice" })]);

    const row = f.root.querySelector<HTMLElement>(".vb-player-row")!;
    const minus = row.querySelector<HTMLButtonElement>(".vb-score-adjust--minus")!;
    const plus = row.querySelector<HTMLButtonElement>(".vb-score-adjust--plus")!;
    const name = row.querySelector<HTMLElement>(".vb-player-name")!;
    const score = row.querySelector<HTMLElement>(".vb-player-score")!;

    // DOM order: minus < identity/name < score < plus.
    const order = Array.from(row.children);
    expect(order.indexOf(minus)).toBe(0);
    expect(order.indexOf(name.closest(".vb-player-identity") as HTMLElement)).toBe(1);
    expect(order.indexOf(score.parentElement as HTMLElement)).toBe(2);
    expect(order.indexOf(plus)).toBe(3);
  });

  it("renders controls for every player, including the host themselves", () => {
    const f = mount({ isHost: true });
    f.set([
      player({ uid: "u1", name: "Alice", isHost: true }),
      player({ uid: "u2", name: "Bob" }),
    ]);
    expect(f.root.querySelectorAll(".vb-score-adjust").length).toBe(4);
  });

  it("uses the required accessible labels and titles", () => {
    const f = mount({ isHost: true });
    f.set([player({ uid: "u1", name: "Alice" })]);
    const minus = f.root.querySelector<HTMLButtonElement>(".vb-score-adjust--minus")!;
    const plus = f.root.querySelector<HTMLButtonElement>(".vb-score-adjust--plus")!;
    expect(minus.getAttribute("aria-label")).toBe("Remove 1 point from Alice");
    expect(minus.title).toBe("Remove 1 point from Alice");
    expect(plus.getAttribute("aria-label")).toBe("Add 1 point to Alice");
    expect(plus.title).toBe("Add 1 point to Alice");
  });

  it("calls the canonical adjustment with delta −1 / +1", async () => {
    const f = mount({ isHost: true });
    f.set([player({ uid: "u1", name: "Alice" })]);
    const minus = f.root.querySelector<HTMLButtonElement>(".vb-score-adjust--minus")!;
    const plus = f.root.querySelector<HTMLButtonElement>(".vb-score-adjust--plus")!;

    minus.click();
    expect(f.calls).toEqual([{ uid: "u1", delta: -1 }]);
    f.gate.release?.();
    await flush();

    plus.click();
    expect(f.calls).toEqual([
      { uid: "u1", delta: -1 },
      { uid: "u1", delta: 1 },
    ]);
    f.gate.release?.();
    await flush();
  });

  it("marks only the clicked control pending and blocks duplicate clicks", async () => {
    const f = mount({ isHost: true });
    f.set([player({ uid: "u1", name: "Alice" })]);
    const minus = f.root.querySelector<HTMLButtonElement>(".vb-score-adjust--minus")!;
    const plus = f.root.querySelector<HTMLButtonElement>(".vb-score-adjust--plus")!;

    minus.click();
    minus.click(); // disabled while pending → no duplicate write
    expect(minus.disabled).toBe(true);
    expect(plus.disabled).toBe(false); // only the clicked control is pending
    expect(f.calls.length).toBe(1);

    f.gate.release?.();
    await flush();
    expect(minus.disabled).toBe(false);
  });

  it("marks row and buttons with data-disable-buzz-shortcuts", () => {
    const f = mount({ isHost: true });
    f.set([player({ uid: "u1", name: "Alice" })]);
    const row = f.root.querySelector<HTMLElement>(".vb-player-row")!;
    expect(row.hasAttribute("data-disable-buzz-shortcuts")).toBe(true);
    for (const btn of row.querySelectorAll<HTMLButtonElement>(".vb-score-adjust")) {
      expect(btn.hasAttribute("data-disable-buzz-shortcuts")).toBe(true);
      expect(btn.type).toBe("button");
    }
  });
});

describe("non-host player rows", () => {
  it("renders no score adjustment controls", () => {
    const f = mount({ isHost: false, uid: "u2" });
    f.set([player({ uid: "u1", name: "Alice" }), player({ uid: "u2", name: "Bob" })]);
    expect(f.root.querySelectorAll(".vb-score-adjust").length).toBe(0);
  });

  it("keeps identity, score badge and presence state aligned", () => {
    const f = mount({ isHost: false, uid: "u2" });
    f.set([player({ uid: "u1", name: "Alice", score: 7 })]);
    const row = f.root.querySelector<HTMLElement>(".vb-player-row")!;
    expect(row.querySelector(".vb-player-name")!.textContent).toBe("Alice");
    expect(row.querySelector(".vb-player-score")!.textContent).toBe("7");
    expect(row.querySelector(".vb-player-status")!.textContent).toBe("online");
  });
});

/* ------------------------------------------------------------------ */
/*  Live updates / stability                                           */
/* ------------------------------------------------------------------ */

describe("live score updates", () => {
  it("updates scores in place without rebuilding rows", () => {
    const f = mount({ isHost: true });
    f.set([player({ uid: "u1", name: "Alice", score: 1 })]);
    const before = f.root.querySelector<HTMLElement>(".vb-player-row")!;
    const scoreEl = before.querySelector(".vb-player-score")!;
    expect(scoreEl.textContent).toBe("1");

    f.set([player({ uid: "u1", name: "Alice", score: 2 })]);
    const after = f.root.querySelector<HTMLElement>(".vb-player-row")!;
    expect(after).toBe(before); // same node — no flicker/rebuild
    expect(after.querySelector(".vb-player-score")!.textContent).toBe("2");
  });

  it("keeps rows stable when a score change does not alter the ranking", () => {
    const f = mount({ isHost: true });
    f.set([
      player({ uid: "u1", name: "Alice", score: 5, joinedAt: 100 }),
      player({ uid: "u2", name: "Bob", score: 3, joinedAt: 200 }),
    ]);
    const [first, second] = rowsOf(f);

    // Alice +1 → 6: ranking (6 > 3) unchanged.
    f.set([
      player({ uid: "u1", name: "Alice", score: 6, joinedAt: 100 }),
      player({ uid: "u2", name: "Bob", score: 3, joinedAt: 200 }),
    ]);
    const [firstAfter, secondAfter] = rowsOf(f);
    expect(firstAfter).toBe(first);
    expect(secondAfter).toBe(second);
  });

  it("reorders only when the documented ranking rule changes", () => {
    const f = mount({ isHost: true });
    f.set([
      player({ uid: "u1", name: "Alice", score: 5, joinedAt: 100 }),
      player({ uid: "u2", name: "Bob", score: 3, joinedAt: 200 }),
    ]);
    const aliceRow = rowsOf(f)[0]!;

    // Bob jumps to 10 → he now ranks first.
    f.set([
      player({ uid: "u1", name: "Alice", score: 5, joinedAt: 100 }),
      player({ uid: "u2", name: "Bob", score: 10, joinedAt: 200 }),
    ]);
    expect(rowsOf(f)[0]!.dataset.uid).toBe("u2");
    expect(rowsOf(f)[1]!.dataset.uid).toBe("u1");
    expect(rowsOf(f)[1]).toBe(aliceRow); // moved, not rebuilt
  });

  it("does not touch round/video state (component only renders scores)", () => {
    // Structural guarantee: the component's public surface has no round,
    // playback or queue handles at all.
    const f = mount({ isHost: true });
    f.set([player({ uid: "u1" })]);
    const handles = f.root as unknown as Record<string, unknown>;
    expect(handles.round).toBeUndefined();
    expect(handles.video).toBeUndefined();
    expect(handles.queue).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Indicators & empty state                                           */
/* ------------------------------------------------------------------ */

describe("indicators", () => {
  it("marks the current user with You and hosts with a crown", () => {
    const f = mount({ isHost: false, uid: "u2" });
    f.set([
      player({ uid: "u1", name: "Alice", isHost: true }),
      player({ uid: "u2", name: "Bob" }),
    ]);
    const rows = rowsOf(f);
    expect(rows[0]!.querySelector(".vb-player-host")).not.toBeNull();
    expect(rows[1]!.querySelector(".vb-player-status")!.textContent).toBe("You");
  });

  it("marks offline players subdued with a readable label", () => {
    const f = mount({ isHost: false, uid: "u2" });
    f.set([player({ uid: "u1", presenceState: "offline" })]);
    const row = f.root.querySelector<HTMLElement>(".vb-player-row")!;
    expect(row.classList.contains("vb-player-row--offline")).toBe(true);
    expect(row.querySelector(".vb-player-status")!.textContent).toBe("offline");
  });

  it("shows the online count in the header", () => {
    const f = mount({ isHost: true });
    f.set([
      player({ uid: "u1" }),
      player({ uid: "u2", presenceState: "offline" }),
    ]);
    expect(f.root.querySelector(".vb-player-count")!.textContent).toBe("1/2 online");
  });

  it("shows the empty state when no players exist", () => {
    const f = mount({ isHost: true });
    f.set([]);
    expect(f.root.querySelector(".vb-empty")!.textContent).toBe("Waiting for players…");
    expect(f.root.querySelectorAll(".vb-player-row").length).toBe(0);
  });
});
