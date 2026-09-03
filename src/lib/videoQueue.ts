import { get, onValue, ref, update, type Unsubscribe } from "firebase/database";
import type {
  QueueItem,
  VideoQueueSnapshot,
} from "../types/queue";
import type { RoomCode, UserId } from "../types";
import { getFirebaseDatabase } from "./firebase";
import {
  queueItemPath,
  queueItemsPath,
  queuePath,
  queueRevisionPath,
  roomGamePath,
  roomRoundPath,
  roomVideoPath,
} from "./paths";
import { serverNow } from "./timestamp";
import {
  computeMovePatch,
  findQueuedDuplicate,
  resolveQueueView,
  validateQueueDraft,
  YT_ID_RE,
} from "../types/queue";

/* ------------------------------------------------------------------ */
/*  Watch                                                              */
/* ------------------------------------------------------------------ */

/** Subscribes to the canonical queue node. Returns an unsubscribe fn. */
export function watchVideoQueue(
  code: RoomCode,
  onChange: (snapshot: VideoQueueSnapshot) => void,
): Unsubscribe {
  return onValue(ref(getFirebaseDatabase(), queuePath(code)), (snap) => {
    onChange((snap.val() ?? {}) as VideoQueueSnapshot);
  });
}

export async function fetchVideoQueue(
  code: RoomCode,
): Promise<VideoQueueSnapshot> {
  const snap = await get(ref(getFirebaseDatabase(), queuePath(code)));
  return (snap.val() ?? {}) as VideoQueueSnapshot;
}

async function fetchRoundNumberOnce(code: RoomCode): Promise<number> {
  const snap = await get(
    ref(getFirebaseDatabase(), `${roomGamePath(code)}/round/number`),
  );
  const n = snap.val();
  return typeof n === "number" ? n : 0;
}

/* ------------------------------------------------------------------ */
/*  Host mutations                                                     */
/* ------------------------------------------------------------------ */

/**
 * Adds a queue item WITHOUT launching it. Duplicate handling:
 * `allowDuplicate=false` throws a typed error so the UI can ask for
 * confirmation, then retries with true.
 */
export async function addToQueue(
  code: RoomCode,
  hostUid: UserId,
  rawUrl: string,
  opts: { allowDuplicate: boolean },
): Promise<{ item: QueueItem; duplicateConfirmed: boolean }> {
  const snapshot = await fetchVideoQueue(code);
  const view = resolveQueueView(snapshot, null);
  const draft = validateQueueDraft(rawUrl, view.items, opts);
  if (!draft.ok) throw new Error(`queue:${draft.error}`);

  const item: QueueItem = {
    ...draft.draft,
    addedAt: serverNow(),
    addedBy: hostUid,
  };
  await update(ref(getFirebaseDatabase()), {
    [queueItemPath(code, item.id)]: item,
    [queueRevisionPath(code)]: view.revision + 1,
  });
  const dupe = findQueuedDuplicate(view.items, item.videoId);
  return { item, duplicateConfirmed: !!dupe && opts.allowDuplicate };
}

/** One-step reorder; single multi-path update swapping only two positions. */
export async function moveQueueItem(
  code: RoomCode,
  itemId: string,
  direction: "up" | "down",
): Promise<void> {
  const snapshot = await fetchVideoQueue(code);
  const items = Object.values(snapshot.items ?? {});
  const patch = computeMovePatch(items, itemId, direction);
  const entries = Object.entries(patch);
  if (entries.length === 0) return; // boundary no-op — nothing to write

  const updates: Record<string, unknown> = {};
  for (const [id, pos] of entries) updates[`${queueItemsPath(code)}/${id}/position`] = pos.position;
  updates[queueRevisionPath(code)] = (snapshot.revision ?? 0) + 1;
  await update(ref(getFirebaseDatabase()), updates);
}

/** Removes a non-active queued item. Active item guard is enforced here too. */
export async function removeQueueItem(
  code: RoomCode,
  itemId: string,
): Promise<void> {
  const snapshot = await fetchVideoQueue(code);
  if (snapshot.activeItemId === itemId) {
    throw new Error("queue:active-cannot-be-removed");
  }
  await update(ref(getFirebaseDatabase()), {
    [queueItemPath(code, itemId)]: null,
    [queueRevisionPath(code)]: (snapshot.revision ?? 0) + 1,
  });
}

/** Clears every non-active queued item after host confirmation upstream. */
export async function clearNonActiveQueue(code: RoomCode): Promise<number> {
  const snapshot = await fetchVideoQueue(code);
  const items = Object.values(snapshot.items ?? {});
  const removable = items.filter((it) => it.id !== snapshot.activeItemId);
  if (removable.length === 0) return 0;

  const updates: Record<string, unknown> = {};
  for (const it of removable) updates[`${queueItemsPath(code)}/${it.id}`] = null;
  // Renumber survivors deterministically from zero.
  const active =
    snapshot.activeItemId != null ? items.find((it) => it.id === snapshot.activeItemId) : undefined;
  let nextPos = 0;
  for (const it of [...items]
    .filter((x) => !removable.includes(x))
    .sort((a, b) => a.position - b.position)) {
    if (it.id !== active?.id || nextPos > 0) updates[`${queueItemsPath(code)}/${it.id}/position`] = nextPos;
    nextPos += 1;
  }
  updates[queueRevisionPath(code)] = (snapshot.revision ?? 0) + 1;
  await update(ref(getFirebaseDatabase()), updates);
  return removable.length;
}

/* ------------------------------------------------------------------ */
/*  Launch / switch                                                    */
/* ------------------------------------------------------------------ */

export interface LaunchOptions {
  /** Start global playback immediately instead of pausing at ready state. */
  autoplay?: boolean;
}

/**
 * THE switching primitive (host-only per rules).
 *
 * ONE atomic multi-path update performs ALL of:
 *   - videoQueue/activeItemId ← itemId (+ revision++ via seq-like bump)
 *   - /video ← coherent playback state (videoId, paused-at-0 or playing,
 *     changedAt/By, seq+1, activeQueueItemId, videoSessionId+1)
 *   - /game/round ← safe reset to idle with an incremented number so no old
 *     buzz/round event can survive the switch.
 *
 * Stale-command invalidation: /video.seq increments and /video.videoSessionId
 * bumps; every client's existing appliedSeq guard plus the main.ts round→
 * session fingerprint map drops commands/events from previous sessions.
 *
 * RTDB limitation (documented): multi-path update() is atomic but CANNOT run
 * transactionally across paths; the current video node is read once to derive
 * seq/session. With a single live host this matches reality; rules still gate
 * every written path to the host independently.
 */
export async function launchQueueItem(
  code: RoomCode,
  hostUid: UserId,
  itemId: string,
  opts: LaunchOptions = {},
): Promise<void> {
  const db = getFirebaseDatabase();

  const [videoSnap, queueSnap, roundNumber] = await Promise.all([
    get(ref(db, roomVideoPath(code))),
    get(ref(db, queuePath(code))),
    fetchRoundNumberOnce(code),
  ]);

  const curVideo = (videoSnap.val() ?? {}) as {
    videoId?: string;
    playing?: boolean;
    currentTimeSec?: number;
    changedAt?: number;
    changedBy?: string;
    seq?: number;
    activeQueueItemId?: string | null;
    videoSessionId?: number;
  };

  // Resolve the target item directly from the authoritative snapshot.
  const items = Object.values(((queueSnap.val() ?? {}) as VideoQueueSnapshot).items ?? {});
  const target = items.find((it) => it && typeof it.id === "string" && it.id === itemId);
  if (!target) throw new Error("queue:item-not-found");
  if (!YT_ID_RE.test(target.videoId)) throw new Error("queue:item-invalid-id");

  // Idempotence: relaunching the ALREADY-active item must not restart audio/video.
  if (
    curVideo.activeQueueItemId === itemId &&
    curVideo.videoId === target.videoId &&
    typeof curVideo.seq === "number"
  ) {
    return;
  }

  const now = serverNow();
  const updates: Record<string, unknown> = {
    [`rooms/${code}/video`]: {
      videoId: target.videoId,
      playing: !!opts.autoplay,
      currentTimeSec: 0,
      changedAt: now,
      changedBy: hostUid,
      seq: (curVideo.seq ?? 0) + 1,
      activeQueueItemId: itemId,
      videoSessionId: (curVideo.videoSessionId ?? 0) + 1,
    },
    // Safe round reset that ALSO opens the new round automatically: the
    // moment every client switches to the video (same seq/session bump),
    // the round is already "open" so buzzers are armed without any extra
    // host click. Host still opens SUBSEQUENT rounds via "New round"
    // after each verdict, exactly like before.
    [roomRoundPath(code)]: {
      number: roundNumber + 1,
      state: "open",
      openedAt: now,
      buzz: null,
    },
    [`${roomGamePath(code)}/status`]: "active",
    // Queue pointer + revision bump for client reconciliation.
    [`${queuePath(code)}/activeItemId`]: itemId,
    [queueRevisionPath(code)]: ((queueSnap.val() as VideoQueueSnapshot | null)?.revision ?? 0) + 1,
  };

  await update(ref(db), updates);
  if (import.meta.env.DEV) {
    console.debug(
      `[vq] launched item=${itemId} video=${target.videoId} autoplay=${!!opts.autoplay}`,
      `round=${roundNumber + 1} (auto-opened)`,
    );
  }
}
