import type { UserId } from "./common";

/** Durable queue item status. Currently only "queued" is persisted; other
 *  states are derived (active = id === queue.activeItemId). Kept as a union so
 *  future persistence needs stay backward compatible with rules validation. */
export type QueueItemStatus = "queued" | "active" | "played" | "removed";

/** One canonical, host-owned queue item at /rooms/{roomId}/videoQueue/items/{id}. */
export interface QueueItem {
  /** Stable client-generated uuid — NEVER an array index. */
  id: string;
  /** Extracted YouTube video id (11 chars in practice; validated 6..20). */
  videoId: string;
  /** Optional friendly label; null when unset. */
  title: string | null;
  /** Server timestamp (ms) when added. */
  addedAt: number;
  /** Uid of the host that added it. */
  addedBy: UserId;
  /** Deterministic order field; renumbered atomically on reorder. */
  position: number;
}

/** Snapshot of /rooms/{roomId}/videoQueue (may be absent on legacy rooms). */
export interface VideoQueueSnapshot {
  items?: Record<string, QueueItem>;
  activeItemId?: string | null;
  revision?: number;
}

/** Read-only view model used by both host panel and player summary. */
export interface QueueView {
  items: QueueItem[];
  active: QueueItem | null;
  revision: number;
  /** True when the active item is a synthetic legacy-room placeholder. */
  activeIsLegacy: boolean;
}

export const YT_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

/** Deterministic ordering: position asc → addedAt asc → id asc (stable ties). */
export function sortByPosition(a: QueueItem, b: QueueItem): number {
  return (
    a.position - b.position ||
    a.addedAt - b.addedAt ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Builds the read-only view model from a raw snapshot.
 * Legacy compatibility: rooms created before the queue existed have no
 * /videoQueue node but may still carry /video.videoId. In that case ONE
 * synthetic item is derived in-memory (never written back), pinned first,
 * and treated as the active item until the host launches a real queue entry.
 */
export function resolveQueueView(
  snapshot: VideoQueueSnapshot | null | undefined,
  legacyActiveVideoId: string | null,
): QueueView {
  const realItems = Object.values(snapshot?.items ?? {}).filter(
    (it): it is QueueItem =>
      !!it &&
      typeof it.id === "string" &&
      typeof it.videoId === "string" &&
      typeof it.position === "number",
  );
  realItems.sort(sortByPosition);

  const storedActiveId =
    typeof snapshot?.activeItemId === "string" ? snapshot.activeItemId : null;

  // No queue data at all + legacy video → derive synthetic active item.
  if (realItems.length === 0 && legacyActiveVideoId && YT_ID_RE.test(legacyActiveVideoId)) {
    const synth: QueueItem = {
      id: `legacy-${legacyActiveVideoId}`,
      videoId: legacyActiveVideoId,
      title: null,
      addedAt: 0,
      addedBy: "",
      position: 0,
    };
    return { items: [synth], active: synth, revision: snapshot?.revision ?? 0, activeIsLegacy: true };
  }

  // Hybrid: legacy room gained its first real queued item(s).
  if (
    storedActiveId === null &&
    legacyActiveVideoId &&
    YT_ID_RE.test(legacyActiveVideoId)
  ) {
    const synth: QueueItem = {
      id: `legacy-${legacyActiveVideoId}`,
      videoId: legacyActiveVideoId,
      title: null,
      addedAt: -1, // sorts before all real items (their addedAt >= 1 server clock)
      addedBy: "",
      position: -1,
    };
    return {
      items: [synth, ...realItems],
      active: synth,
      revision: snapshot?.revision ?? 0,
      activeIsLegacy: true,
    };
  }

  const active =
    (storedActiveId
      ? realItems.find((it) => it.id === storedActiveId) ?? null
      : null);
  return { items: realItems, active, revision: snapshot?.revision ?? 0, activeIsLegacy: false };
}

/** Finds an existing QUEUED duplicate of the same video (case-insensitive id). */
export function findQueuedDuplicate(items: QueueItem[], videoId: string): QueueItem | null {
  const needle = videoId.toLowerCase();
  return items.find((it) => it.videoId.toLowerCase() === needle) ?? null;
}

/**
 * Move computation for one-step up/down reordering.
 * Returns per-id patch of new positions, or {} when the move is a no-op
 * (first→up or last→down). Renumbering swaps ONLY the two affected rows —
 * positions are otherwise stable integers, never rewritten wholesale.
 */
export function computeMovePatch(
  items: QueueItem[],
  itemId: string,
  direction: "up" | "down",
): Record<string, { position: number }> {
  const sorted = [...items].sort(sortByPosition);
  const idx = sorted.findIndex((it) => it.id === itemId);
  if (idx < 0) return {};
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= sorted.length) return {}; // boundary no-op

  const current = sorted[idx];
  const target = sorted[targetIdx];
  if (!current || !target) return {};

  const swapA = Math.min(current.position, target.position);
  const swapB = Math.max(current.position, target.position);

  return {
    [current.id]: { position: current.position === swapA ? swapB : swapA },
    [target.id]: { position: target.position === swapB ? swapA : swapB },
  };
}

/**
 * Next launch candidate after `activeId` (or the very first when none active).
 * Reaching the end returns null — NEVER auto-wraps to another video.
 */
export function pickNextLaunchTarget(
  items: QueueItem[],
  activeId: string | null,
): QueueItem | null {
  const sorted = [...items].sort(sortByPosition);
  if (sorted.length === 0) return null;
  if (!activeId) return sorted[0] ?? null;
  const idx = sorted.findIndex((it) => it.id === activeId);
  if (idx < 0) return sorted[0] ?? null;
  return sorted[idx + 1] ?? null; // explicit end-of-queue stop
}

/** The currently active item can never be removed directly. */
export function isRemovable(item: QueueItem, activeId: string | null): boolean {
  return item.id !== activeId;
}

/** Player-side abbreviated queue: active + next N + remaining count. */
export function buildPlayerQueueSummary(view: QueueView, upcomingCount = 4): {
  active: QueueItem | null;
  upcoming: QueueItem[];
  remainingAfterShown: number;
} {
  const sorted = [...view.items].sort(sortByPosition);
  const activeIdx = view.active
    ? sorted.findIndex((it) => it.id === view.active!.id)
    : -1;
  const startIdx = activeIdx >= 0 ? activeIdx + 1 : 0;
  const upcoming = sorted.slice(startIdx, startIdx + upcomingCount);
  const remainingAfterShown = Math.max(0, sorted.length - startIdx - upcoming.length);
  return { active: view.active, upcoming, remainingAfterShown };
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

export type QueueDraftError =
  | "empty-url"
  | "invalid-video-id"
  | "duplicate";

/**
 * Validates a host URL input against existing queued items.
 * Pure — throws nothing; UI decides how to surface `duplicate`.
 */
export function validateQueueDraft(
  rawUrl: string,
  existing: QueueItem[],
  opts: { allowDuplicate: boolean },
): { ok: true; draft: Omit<QueueItem, "addedAt" | "addedBy"> } | { ok: false; error: QueueDraftError } {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { ok: false, error: "empty-url" };
  // extractVideoId handles every supported YouTube URL form; import lazily
  // would break purity, so caller passes extracted id instead? Keep pure:
  const fromYT = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i.exec(trimmed)?.[1];
  const bare = /^[A-Za-z0-9_-]{11}$/.test(trimmed) ? trimmed : null;
  const videoId = fromYT ?? bare;
  if (!videoId) return { ok: false, error: "invalid-video-id" };

  if (!opts.allowDuplicate && findQueuedDuplicate(existing, videoId)) {
    return { ok: false, error: "duplicate" };
  }
  return {
    ok: true,
    draft: {
      id: makeQueueItemId(videoId),
      videoId,
      title: null,
      position: nextFreePosition(existing),
    },
  };
}

let queueItemSeq = 0;
function makeQueueItemId(videoId: string): string {
  queueItemSeq = (queueItemSeq + 1) % 100000;
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}${queueItemSeq}`;
  return `q_${videoId}_${rnd}`.slice(0, 48);
}

function nextFreePosition(existing: QueueItem[]): number {
  let max = -1;
  for (const it of existing) max = Math.max(max, it.position);
  return max + 1;
}
