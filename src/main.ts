import "./style.css";
import "./ui/styles.css";
import { get, ref } from "firebase/database";
import { initAuth } from "./lib/auth";
import {
  watchConnectionState,
  watchServerTimeOffset,
} from "./lib/connection";
import { describeDbError } from "./lib/errors";
import { getFirebaseDatabase } from "./lib/firebase";
import {
  ensureSoundProfileId,
  joinRoom,
  pickColor,
  watchRoomParticipants,
} from "./lib/players";
import { roomPath } from "./lib/paths";
import { loadSavedName, saveDisplayName } from "./lib/profile";
import { attemptBuzz, openNextRound, watchRound } from "./lib/rounds";
import {
  moderateCancel,
  moderateCorrect,
  moderateWrong,
  resetScores,
} from "./lib/moderation";
import {
  createRoom,
  fetchRoom,
  fetchRoomStatus,
  parseRoomCode,
  setAllowHostToBuzz,
} from "./lib/rooms";
import * as presenceService from "./services/presenceService";
import {
  requestPause,
  requestPlay,
  requestResync,
  requestSeek,
  startPlaybackHeartbeat,
  watchVideoState,
} from "./lib/video";
import { extractVideoId } from "./lib/youtube";
import {
  addToQueue,
  clearNonActiveQueue,
  launchQueueItem,
  moveQueueItem,
  removeQueueItem,
  watchVideoQueue,
} from "./lib/videoQueue";
import {
  pickNextLaunchTarget,
  resolveQueueView,
} from "./types/queue";
import type { VideoQueueSnapshot } from "./types/queue";
import {
  createBuzzPanel,
} from "./ui/components/buzz-panel";
import { createBuzzerStage } from "./ui/components/buzzer-stage";
import { createPlayerQueue } from "./ui/components/player-queue";
import {
  createVideoQueuePanel,
  type VideoQueuePanelHandles,
} from "./ui/components/video-queue-panel";
import { createDiagnostics } from "./ui/components/diagnostics";
import { createSoundPanel } from "./ui/components/sound-panel";
import { setupKeyboardBuzz } from "./lib/keyboard-buzz";
import { getStagePlayers } from "./lib/stage-selectors";
import {
  clearProcessedEventKeys,
  getAudioStatus,
  markEventProcessed,
  normalizeProfileId,
  playWinnerSound,
  stopActiveSounds,
  unlockAudioFromUserGesture,
} from "./services/proceduralBuzzerAudioService";
import {
  createYoutubePlayer,
  type YoutubePlayerHandles,
} from "./ui/components/youtube-player";
import {
  createHostPanel,
  type HostPanelHandles,
} from "./ui/components/host-panel";
import { createToastHost } from "./ui/components/toast";
import { renderEntryView } from "./ui/views/entry-view";
import { renderRoomView } from "./ui/views/room-view";
import type { ParticipantView, RoomCode, RoomData, UserId } from "./types";

function mountApp(): HTMLDivElement {
  const el = document.querySelector<HTMLDivElement>("#app");
  if (!el) throw new Error("#app mount point is missing in index.html");
  return el;
}

const app = mountApp();
const toasts = createToastHost();

const ROOM_PATH_RE = /^\/room\/([A-Za-z0-9]{6})$/i;

let stopRoom: (() => void) | null = null;
let currentEntry: ReturnType<typeof renderEntryView> | null = null;

/* ---------- Routing helpers ---------- */

function roomCodeFromLocation(): RoomCode | null {
  return ROOM_PATH_RE.exec(location.pathname)?.[1]?.toUpperCase() ?? null;
}

function navigate(path: string, replace = false): void {
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
}

/** Fixes the URL to "/" and shows the entry screen (with optional prefill/message). */
function bounceHome(message = "", prefillCode = ""): void {
  navigate("/", true);
  showEntry(prefillCode, message);
}

/* ---------- Entry screen ---------- */

function showEntry(initialCode = "", message = ""): void {
  stopRoom?.();
  stopRoom = null;

  currentEntry = renderEntryView({
    savedName: loadSavedName(),
    initialCode,
    callbacks: {
      onCreateRoom: (url, name) => void handleCreate(url, name),
      onJoinRoom: (code, name) => void handleJoin(code, name),
    },
  });
  app.replaceChildren(currentEntry.root);
  if (message) currentEntry.showError(message);
}

async function handleCreate(youtubeUrl: string, name: string): Promise<void> {
  // URL is optional (queue-driven rooms). Empty string = idle room; a
  // non-empty value stays defensively validated here too.
  const videoId = youtubeUrl ? extractVideoId(youtubeUrl) ?? "" : "";
  if (youtubeUrl && !videoId) {
    currentEntry?.showError("Enter a valid YouTube URL.");
    return;
  }
  let uid: UserId;
  try {
    uid = await initAuth();
  } catch (err) {
    // initAuth errors are already user-readable.
    currentEntry?.showError(err instanceof Error ? err.message : String(err));
    return;
  }
  try {
    const code = await createRoom(uid, videoId);
    await joinRoom(code, uid, { name, color: pickColor(uid) });
    void ensureSoundProfileId(code, uid).catch(() => {});
    saveDisplayName(name);
    navigate(`/room/${code}`);
    await enterRoom(code, uid, name, videoId);
  } catch (err) {
    currentEntry?.showError(describeDbError(err));
  }
}

async function handleJoin(code: string, name: string): Promise<void> {
  let uid: UserId;
  try {
    uid = await initAuth();
  } catch (err) {
    currentEntry?.showError(err instanceof Error ? err.message : String(err));
    return;
  }
  try {
    // Rules expose only game/status before membership; probe it first.
    const status = await fetchRoomStatus(code);
    if (status === null) {
      bounceHome(`Room ${code} does not exist. Double-check the code or link.`);
      return;
    }
    if (status === "ended") {
      bounceHome(`Room ${code} is closed.`);
      return;
    }
    await joinRoom(code, uid, { name, color: pickColor(uid) });
    void ensureSoundProfileId(code, uid).catch(() => {});
    saveDisplayName(name);
    navigate(`/room/${code}`);
    // Full room read becomes permitted only after joining.
    const room = await fetchRoom(code);
    await enterRoom(code, uid, name, room?.video.videoId ?? "");
  } catch (err) {
    currentEntry?.showError(describeDbError(err));
  }
}

/* ---------- Room screen ---------- */

async function enterRoom(
  code: RoomCode,
  uid: UserId,
  displayName: string,
  videoId: string,
): Promise<void> {
  stopRoom?.();

  try {
    const db = getFirebaseDatabase();
    const metaSnap = await get(ref(db, `${roomPath(code)}/meta`));
    const meta = (metaSnap.val() ?? {}) as {
      hostUid?: string;
      allowHostToBuzz?: boolean;
    };
    const isHost = meta.hostUid === uid;
    let allowHostToBuzz = meta.allowHostToBuzz === true;

    const view = renderRoomView({
      code,
      isHost,
      onLeave: () => {
        // Clean leave: final offline write + onDisconnect cancel + teardown.
        void presenceService.stopPresence();
        navigate("/", true);
        showEntry();
      },
    });

    /* Synced YouTube player — created LAZILY on the first real video id so an
       empty room shows the idle placeholder instead of a black iframe. */
    let player: YoutubePlayerHandles | null = null;

    const hostActionHandler = (
      action: "play" | "pause" | "seek" | "restart",
      positionSec: number,
    ) => {
      const write =
        action === "play"
          ? requestPlay(code, uid, positionSec)
          : action === "pause"
            ? requestPause(code, uid, positionSec)
            : requestSeek(code, uid, positionSec); // seek + restart
      void write.catch(() => undefined);
    };

    // Idle placeholder — normal content, NOT .vb-video-error and never an
    // overlay above the player shell (both cannot be visible together).
    const videoEmptyState = document.createElement("div");
    videoEmptyState.className = "vb-video-empty";
    const emptyIcon = document.createElement("span");
    emptyIcon.className = "vb-video-empty__icon";
    emptyIcon.setAttribute("aria-hidden", "true");
    emptyIcon.textContent = "🎬";
    const emptyTitle = document.createElement("h2");
    emptyTitle.textContent = "Waiting for the host to choose a video";
    const emptyHint = document.createElement("p");
    emptyHint.textContent = isHost
      ? "Add videos from the Video Queue panel on the right."
      : "The queue is prepared by the host. Hang tight!";
    videoEmptyState.append(emptyIcon, emptyTitle, emptyHint);
    view.videoColumn.append(videoEmptyState);

    function ensurePlayer(firstVideoId: string): void {
      if (player) return;
      player = createYoutubePlayer(firstVideoId, {
        isHost,
        onHostAction: hostActionHandler,
      });
      view.videoColumn.append(player.root);
      videoEmptyState.hidden = true;
    }

    /* Buzzer Stage — created before doBuzz so it can drive pending feedback. */
    const stage = createBuzzerStage();
    view.stageColumn.append(stage.root);

    /* Buzzer */
    let buzzLock = false;
    const buzzPanel = createBuzzPanel({ onBuzz: () => doBuzz() });

    function doBuzz(): void {
      // Unlock audio synchronously within the user gesture before the RTDB transaction.
      // Do not await; user activation can expire if we await long async tasks.
      void unlockAudioFromUserGesture().catch(() => {});
      // Double-click / repeat protection lives here AND in the transaction.
      if (buzzLock || !buzzPanel.isEnabled()) return;
      buzzLock = true;
      buzzPanel.markPending(true);
      // Neutral pending light on my own podium — never a winner indication.
      stage.setPending(uid, true);

      const videoTime = player?.getPosition() ?? 0;
      attemptBuzz(code, uid, displayName, videoTime)
        .then(() => {
          buzzLock = false;
          buzzPanel.markPending(false);
          stage.setPending(uid, false);
          // Won/taken UI renders from the authoritative watchRound snapshot.
        })
        .catch(() => {
          // Transaction failed (offline/rule): release the lock, round unchanged.
          buzzLock = false;
          buzzPanel.markPending(false);
          stage.setPending(uid, false);
        });
    }

    buzzPanel.setContext({
      playerId: uid,
      viewerIsHost: isHost,
      allowHostToBuzz,
      hasPendingAttempt: false,
    });

    // Seed from the creation-time id (legacy rooms keep their behavior).
    if (videoId) ensurePlayer(videoId);

    view.buzzerColumn.append(buzzPanel.root);

    /* Game sound controls (must not block BUZZ button) */
    const soundPanel = createSoundPanel({
      code,
      uid,
      initialProfileId: null,
    });
    // Place sound controls below the stage but still in sidebar; never covers buzzer.
    view.sidebar.append(soundPanel.root);
    // Ensure durable sound profile exists (deterministic fallback)
    void ensureSoundProfileId(code, uid).then((pid) => {
      // keep UI in sync with persisted value
      try {
        // dynamic import to avoid cycle, but we already have panel
        soundPanel.setProfile(pid as import("./services/proceduralBuzzerAudioService").BuzzerSoundProfileId);
      } catch {
        // ignore
      }
    });

    /* Host moderation */
    let moderating = false;
    let participants: ParticipantView[] = [];
    let hostPanel: HostPanelHandles | null = null;

    const runModeration = (action: () => Promise<unknown>, okMessage: string): void => {
      if (moderating) return;
      moderating = true;
      hostPanel?.setBusy(true);
      action()
        .then(() => toasts.show(okMessage, "success"))
        .catch((err) => toasts.show(describeDbError(err), "error"))
        .finally(() => {
          moderating = false;
          hostPanel?.setBusy(false);
        });
    };

    if (isHost) {
      hostPanel = createHostPanel({
        onCorrect: () =>
          runModeration(
            () => moderateCorrect(code, uid, player?.getPosition() ?? 0),
            "Correct! +1 point — resuming",
          ),
        onWrong: () =>
          runModeration(
            () => moderateWrong(code, uid, player?.getPosition() ?? 0),
            "Answer rejected — resuming",
          ),
        onCancel: () =>
          runModeration(() => moderateCancel(code), "Buzz cancelled — round reopened"),
        onNewRound: () => runModeration(() => openNextRound(code), "New round opened"),
        onResync: () =>
          runModeration(
            () => requestResync(code, uid, player?.getPosition() ?? 0),
            "Re-sync broadcast to everyone",
          ),
        onResetScores: () =>
          runModeration(
            () => resetScores(code, participants.map((p) => p.uid)),
            "All scores reset to 0",
          ),
        onToggleHostBuzz: (allow) => {
          allowHostToBuzz = allow;
          buzzPanel.setContext({
            playerId: uid,
            viewerIsHost: isHost,
            allowHostToBuzz: allow,
            hasPendingAttempt: false,
          });
          void setAllowHostToBuzz(code, allow).catch(() => {
            // Revert on failure so UI and server stay consistent.
            allowHostToBuzz = !allow;
            hostPanel?.setHostBuzzAllowed(allowHostToBuzz);
            buzzPanel.setContext({
              playerId: uid,
              viewerIsHost: isHost,
              allowHostToBuzz: allowHostToBuzz,
              hasPendingAttempt: false,
            });
            toasts.show("Could not update host buzz setting.", "error");
          });
        },
      });
      hostPanel.setHostBuzzAllowed(allowHostToBuzz);
      view.sidebar.append(hostPanel.root);
    }

    /* Diagnostics (collapsible, read-only) */
    let lastSyncedPos: number | null = null;
    const diagnostics = createDiagnostics({
      getLocalPosition: () => player?.getPosition() ?? 0,
      getLastSyncedPosition: () => lastSyncedPos,
      onForcePresenceRefresh: () => void presenceService.forcePresenceRefresh(),
    });
    diagnostics.setRole(isHost);
    diagnostics.setRoomCode(code);
    view.sidebar.append(diagnostics.root);

    app.replaceChildren(view.root);

    /* Dev-only: verify buzzer button is visible in the initial viewport. */
    if (import.meta.env.DEV) {
      const checkBuzzerVisibility = (): void => {
        const btn = buzzPanel.root.querySelector<HTMLButtonElement>(".vb-buzz-btn");
        if (!btn) return;
        const { width, height, top, bottom } = btn.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (vw >= 1100 && vh >= 720 && (bottom < 0 || top > vh || width === 0 || height === 0)) {
          console.warn(
            `[vb-layout] buzzer button is below the fold at ${vw}×${vh} — ` +
            `getBoundingClientRect: top=${Math.round(top)} bottom=${Math.round(bottom)}`,
          );
        }
      };
      // Check after layout settles, and on resize.
      requestAnimationFrame(() => requestAnimationFrame(checkBuzzerVisibility));
      window.addEventListener("resize", checkBuzzerVisibility, { passive: true });
    }

    /* Keyboard shortcuts (Space / Enter / NumpadEnter) */
    let modalOpen = false;
    hostPanel?.onModalOpenChange?.((open: boolean) => { modalOpen = open; });
    const unKeyboard = setupKeyboardBuzz({
      getState: () => ({
        buzzEnabled: buzzPanel.isEnabled(),
        connected: localConnected,
        modalOpen,
      }),
      onBuzz: () => doBuzz(),
      onDebug: import.meta.env.DEV ? (msg) => console.debug(msg) : undefined,
    });

    /* Live subscriptions */
    let localConnected = true;
    let serverOffsetMs = 0;
    let stopHeartbeat: (() => void) | null = null;
    let lastAutoPausedRound = -1;
    let latestRound: RoomData["game"]["round"] | null = null;

    let buzzGateActive = false;
    function refreshBuzzGate(): void {
      if (!localConnected) return; // "Connection lost" override keeps priority
      if (!activeVideoId) {
        buzzPanel.setStatus("Waiting for the host to choose a video");
        buzzGateActive = true;
      } else if (buzzGateActive) {
        buzzPanel.setStatus(null); // release our own gate only
        buzzGateActive = false;
      }
      videoEmptyState.hidden = !!activeVideoId;
    }

    const resolveWinnerColor = (): void => {
      const winnerId = latestRound?.buzz?.playerId;
      buzzPanel.setWinnerColor(
        winnerId ? participants.find((p) => p.uid === winnerId)?.color ?? null : null,
      );
    };

    // Canonical live presence: auth -> /.info/connected -> onDisconnect-FIRST
    // -> online write -> 20s lastSeenAt heartbeat (see presenceService).
    void presenceService.startPresence(code, { uid, displayName });

    const unParticipants = watchRoomParticipants(
      code,
      {
        selfUid: uid,
        isSelfConnected: () => localConnected,
        getServerNow: presenceService.getEstimatedServerNow,
      },
      (list) => {
        participants = list;
        view.setParticipants(list);
        view.setPlayerCount(
          list.filter((p) => p.presenceState === "online").length,
          list.length,
        );
        resolveWinnerColor();
        stage.setPlayers(getStagePlayers(list, latestRound, uid));
        // keep sound panel's selector in sync if profile changed remotely for self
        const self = list.find((p) => p.uid === uid);
        if (self?.soundProfileId) {
          soundPanel.setProfile(self.soundProfileId as import("./services/proceduralBuzzerAudioService").BuzzerSoundProfileId);
        }
      },
    );
    const unConnection = watchConnectionState((online) => {
      localConnected = online;
      view.setConnectionState(online);
      diagnostics.setConnection(online);

      // Hard-block the buzzer while offline; recompute our gates when online.
      buzzPanel.setStatus(online ? null : "Connection lost");

      if (online) {
        refreshBuzzGate();
        // RTDB listeners re-sync by themselves; snap the player back cleanly.
        // The seq guard would skip an unchanged snapshot, hence forceResync.
        player?.forceResync();
      }
    });
    const unOffset = watchServerTimeOffset((ms) => {
      serverOffsetMs = ms;
      buzzPanel.setServerOffset(ms);
      diagnostics.setServerOffset(ms);
    });
    diagnostics.setAuthUid(uid);

    const unPresenceDebug = presenceService.subscribeToRoomPresence(code, (map) => {
      const mine = map[uid];
      diagnostics.setPresenceInfo({
        path: `presence/${code}/${uid}`,
        value: mine ? JSON.stringify(mine) : "(absent)",
      });
    });

    /* ---------------- Video queue (canonical, host-managed) ---------------- */

    // Player read-only summary lives right under the Buzzer Stage.
    const playerQueue = createPlayerQueue();
    view.stageColumn.append(playerQueue.root);

    let latestQueueSnapshot: VideoQueueSnapshot | null = null;

    function launchById(itemId: string, autoplay: boolean): void {
      if (!isHost) return; // UX guard; rules are the real authority
      void launchQueueItem(code, uid, itemId, { autoplay }).catch((err) => {
        toasts.show(describeDbError(err), "error");
        if (import.meta.env.DEV) console.warn("[vq] launch failed", err);
      });
    }

    const hostPanel_: VideoQueuePanelHandles | null = isHost
      ? (() => {
          const panel = createVideoQueuePanel({
            addItem: async (rawUrl, o) => {
              await addToQueue(code, uid, rawUrl, o);
            },
            moveItem: (id, dir) => moveQueueItem(code, id, dir),
            removeItem: (id) => removeQueueItem(code, id),
            clearQueue: () => clearNonActiveQueue(code),
            launch: launchById,
            playNext: () => {
              const view = resolveQueueView(latestQueueSnapshot, null);
              const target = pickNextLaunchTarget(view.items, view.active?.id ?? null);
              if (target) launchById(target.id, false);
              else toasts.show("End of queue — add another video.", "error");
            },
          });
          view.sidebar.append(panel.root);
          return panel;
        })()
      : null;

    const unQueue = watchVideoQueue(code, (rawSnap) => {
      // Read-time legacy adapter: before the host adds anything, an older room
      // has NO /videoQueue node; its /video.videoId renders as a synthetic
      // read-only active item. Nothing is ever written back.
      const exists = rawSnap != null && typeof rawSnap === "object" && Object.keys(rawSnap).length > 0;
      const legacyActiveVideoId = exists ? "" : videoId;
      const snap = (exists ? rawSnap : {}) as VideoQueueSnapshot;
      latestQueueSnapshot = snap;
      const v = resolveQueueView(snap, legacyActiveVideoId);
      playerQueue.setView(v);
      hostPanel_?.setSnapshot(snap, legacyActiveVideoId);
    });

    let isFirstRoundCallback = true;
    // Session staleness guard: fingerprint of the playback session at the time
    // each round number was observed OPEN. Any buzzed event whose stored
    // fingerprint differs from the CURRENT one belongs to a previous video and
    // is rendered as historical only (no reflex pause, no sound, no flash).
    const roundSessionByNumber = new Map<number, string>();
    let activeVideoId = videoId;
    let activeSessionFingerprint = `${videoId}:0`;

    const unRound = watchRound(code, (round) => {
      latestRound = round;
      buzzPanel.setRound(round);
      hostPanel?.setRound(round);
      diagnostics.setRound(round);
      view.setRoundStatus(round.state);
      resolveWinnerColor();
      stage.setPlayers(getStagePlayers(participants, round, uid));

      if (round.state === "open" && !round.buzz) {
        roundSessionByNumber.set(round.number, activeSessionFingerprint);
      }

      // Procedural winner sound — local reaction only, never decides winner.
      // Reuse confirmed buzz event model: round buzzed + winner + roundNumber + buzzedAt
      const initialCallback = isFirstRoundCallback;
      if (round.state === "buzzed" && round.buzz) {
        const buzzKey = `${code}:${round.number}:${round.buzz.playerId}:${round.buzz.buzzedAt}`;
        const storedFp = roundSessionByNumber.get(round.number);
        const isStaleSession = storedFp !== null && storedFp !== activeSessionFingerprint;
        // Late join / refresh / stale-session → static final state only.
        const renderStatic = initialCallback || isStaleSession;

        stage.notifyBuzzEvent({
          buzzEventKey: buzzKey,
          winnerId: round.buzz.playerId,
          isInitialSnapshot: renderStatic,
        });
        if (!renderStatic) {
          const winner = participants.find((p) => p.uid === round.buzz!.playerId);
          const rawProfile = winner?.soundProfileId;
          const profileId = normalizeProfileId(rawProfile, round.buzz.playerId);
          if (import.meta.env.DEV) console.debug("[audio] confirmed winner", { buzzKey, profileId, winnerId: round.buzz.playerId });
          void playWinnerSound(profileId as import("./services/proceduralBuzzerAudioService").BuzzerSoundProfileId, buzzKey).then(() => {
            if (getAudioStatus() !== "ready") soundPanel.setBlockedHintVisible(true);
          });
        } else {
          markEventProcessed(buzzKey);
          if (import.meta.env.DEV) console.debug("[audio] static winner render (initial/stale), suppress playback", buzzKey, { isStaleSession });
        }
      } else {
        // Round resolved / rejected / cancelled / reopened → clean neutral state.
        stage.clearBuzzVisual();
      }
      isFirstRoundCallback = false;

      // Buzz reflex: EVERY client pauses its local player immediately…
      // Only for live, session-current rounds; never for a stale or
      // first-snapshot (historical) event.
      const currentReflexNumber = round.state === "buzzed" ? round.number : -1;
      if (
        currentReflexNumber >= 0 &&
        !initialCallback &&
        roundSessionByNumber.get(currentReflexNumber) === activeSessionFingerprint &&
        currentReflexNumber !== lastAutoPausedRound
      ) {
        lastAutoPausedRound = currentReflexNumber;
        player?.pauseLocal();
        if (isHost) {
          void requestPause(code, uid, player?.getPosition() ?? 0).catch(
            () => undefined,
          );
        }
      }
      if (roundSessionByNumber.size > 64) {
        for (const k of roundSessionByNumber.keys()) {
          if (k < round.number) roundSessionByNumber.delete(k);
        }
      }
    });

    const unVideo = watchVideoState(code, (state) => {
      const vid = typeof state?.videoId === "string" ? state.videoId : "";
      activeVideoId = vid;
      activeSessionFingerprint = `${vid}:${state?.videoSessionId ?? 0}`;

      // Lazy player creation on the first real video; switch-to-video itself
      // is handled inside the player via the same remote snapshot (seq-guarded).
      if (vid) ensurePlayer(vid);

      refreshBuzzGate();
      player?.applyRemote(state, serverOffsetMs);
      lastSyncedPos = state.currentTimeSec;
      hostPanel?.setVideoPlaying(state.playing);

      // Optional periodic re-anchor: only the host beats, only while playing.
      const wantsHeartbeat = isHost && state.playing && player !== null && !!vid;
      if (wantsHeartbeat && stopHeartbeat === null) {
        stopHeartbeat = startPlaybackHeartbeat(code, uid, () => player?.getPosition() ?? 0);
      } else if (!wantsHeartbeat && stopHeartbeat !== null) {
        stopHeartbeat();
        stopHeartbeat = null;
      }
    });

    stopRoom = () => {
      unKeyboard();
      unParticipants();
      unPresenceDebug();
      unConnection();
      unOffset();
      unQueue();
      unRound();
      unVideo();
      stopHeartbeat?.();
      player?.dispose();
      buzzPanel.dispose();
      stage.dispose();
      playerQueue.root.remove();
      hostPanel_?.dispose();
      soundPanel.dispose();
      stopActiveSounds();
      clearProcessedEventKeys();
      diagnostics.dispose();
      void presenceService.stopPresence();
    };
  } catch (err) {
    bounceHome(describeDbError(err), code);
  }
}

/**
 * Enters a room reached by direct URL or back/forward navigation.
 * Validates existence, closed state and that the visitor already has a
 * display name; otherwise bounces to the entry screen with context.
 */
async function openRoomByCode(code: RoomCode): Promise<void> {
  let uid: UserId;
  try {
    uid = await initAuth();
  } catch (err) {
    bounceHome(err instanceof Error ? err.message : String(err), code);
    return;
  }

  let status: "lobby" | "active" | "ended" | null;
  try {
    status = await fetchRoomStatus(code);
  } catch (err) {
    bounceHome(describeDbError(err), code);
    return;
  }
  if (status === null) {
    bounceHome(`Room ${code} does not exist. Double-check the code or link.`);
    return;
  }
  if (status === "ended") {
    bounceHome(`Room ${code} is closed.`);
    return;
  }

  const savedName = loadSavedName();
  if (!savedName) {
    bounceHome(`Choose a display name to join room ${code}.`, code);
    return;
  }

  try {
    await joinRoom(code, uid, { name: savedName, color: pickColor(uid) });
    void ensureSoundProfileId(code, uid).catch(() => {});
  } catch (err) {
    bounceHome(describeDbError(err), code);
    return;
  }

  // Full read is permitted only after joining.
  let room: RoomData | null;
  try {
    room = await fetchRoom(code);
  } catch (err) {
    bounceHome(describeDbError(err), code);
    return;
  }
  if (!room) {
    bounceHome("This room was just closed or removed.", code);
    return;
  }
  await enterRoom(code, uid, savedName, room.video.videoId);
}

/* ---------- Router ---------- */

async function route(): Promise<void> {
  const code = roomCodeFromLocation();
  if (code) {
    await openRoomByCode(code);
    return;
  }
  // Legacy ?room=CODE deep links redirect to the canonical /room/CODE path.
  if (location.pathname === "/") {
    const legacy = parseRoomCode(new URLSearchParams(location.search).get("room") ?? "");
    if (legacy) {
      history.replaceState({}, "", `/room/${legacy}`);
      await openRoomByCode(legacy);
      return;
    }
  }
  showEntry();
}

async function boot(): Promise<void> {
  window.addEventListener("popstate", () => void route());

  await route();
}

void boot();
