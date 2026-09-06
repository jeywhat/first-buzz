import "./style.css";
import "./ui/styles.css";
import { get, limitToLast, onValue, query, ref } from "firebase/database";
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
import { roomPath, scoreEventsPath } from "./lib/paths";
import { loadSavedName, saveDisplayName } from "./lib/profile";
import {
  attemptBuzz,
  completeCooldown,
  openNextRound,
  resumeAndOpenNextRound,
  watchRound,
} from "./lib/rounds";
import { RESUME_BUZZ_COOLDOWN_MS } from "./lib/buzz-rules";
import { resetScores } from "./lib/moderation";
import {
  adjustPlayerScore,
  type ScoreEvent,
} from "./lib/scoring";
import { formatScoreAdjustmentToast } from "./lib/player-row";
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
import { createBuzzPopup } from "./ui/components/buzz-popup";
import {
  createLocalMediaCompatibilityService,
} from "./services/localMediaCompatibilityService";
import { createMediaUnlockCard } from "./ui/components/media-unlock-card";
import { createMediaActivationOverlay } from "./ui/components/media-activation-overlay";
import { createPlayerQueue } from "./ui/components/player-queue";
import {
  createVideoQueuePanel,
  type VideoQueuePanelHandles,
} from "./ui/components/video-queue-panel";
import { createDiagnostics } from "./ui/components/diagnostics";
import { createSoundPanel } from "./ui/components/sound-panel";
import { setupKeyboardBuzz } from "./lib/keyboard-buzz";

import {
  clearProcessedEventKeys,
  getAudioPreferences,
  getAudioStatus,
  markEventProcessed,
  normalizeProfileId,
  playWinnerSound,
  setMuted,
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
import { createManualScoring } from "./ui/components/manual-scoring";
import { createScoreFeed } from "./ui/components/score-feed";
import { renderEntryView } from "./ui/views/entry-view";
import { renderRoomView } from "./ui/views/room-view";
import type { ParticipantView, RoomCode, RoomData, UserId, VideoState } from "./types";

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
      uid,
      isHost,
      onLeave: () => {
        // Clean leave: final offline write + onDisconnect cancel + teardown.
        void presenceService.stopPresence();
        navigate("/", true);
        showEntry();
      },
      onAdjustScore: (targetUid, delta) => applyScoreAdjust(targetUid, delta),
    });

    /* ---------------- Canonical host score adjustment ----------------
       THE single UI wrapper around adjustPlayerScore (scoring.ts).
       Used by the Players panel rows, the buzzer stage and the
       advanced scoring form — never a second write path. Errors are
       toasted here so callers only manage their pending state. */
    async function applyScoreAdjust(
      targetUid: UserId,
      delta: number,
      reason: string | null = null,
    ): Promise<void> {
      if (!isHost) return; // UX guard; Firebase rules are the real authority
      if (!localConnected) {
        toasts.show("You are offline — score change not applied.", "error");
        return;
      }
      const target = participants.find((p) => p.uid === targetUid);
      const name = target?.name ?? "player";
      try {
        const res = await adjustPlayerScore(code, targetUid, delta, {
          targetDisplayName: target?.name ?? String(targetUid),
          changedBy: uid,
          reason,
          videoSessionId: latestVideoSessionId,
          roundNumber: latestRound?.number ?? null,
          viewerIsHost: isHost,
        });
        // Toast only AFTER Firebase confirmed the durable score write.
        toasts.show(formatScoreAdjustmentToast(delta, name));
        if (res.eventWriteFailed) {
          toasts.show("Score applied, but the activity log write failed.", "error");
        }
      } catch (err) {
        toasts.show(describeDbError(err), "error");
      }
    }

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

    /* ---------------- Local media compatibility (additive, client-only) --
       The shared Firebase playback truth is untouched: this layer only
       receives read-only snapshots. desktop-compatible clients are fully
       transparent — the unlock UI can never mount (dev-asserted). Restricted
       media clients attempt the normal local sync once; only an OBSERVED
       block (autoplay blocked / player-state mismatch) surfaces the local
       "Tap to start" card. One trusted gesture → existing audio unlock +
       ONE local seek/play of the SAME player. No Firebase writes, no retry
       loops, no second player, no second AudioContext. */
    let latestVideoState: VideoState | null = null;
    const localMedia = createLocalMediaCompatibilityService({
      // iOS/WebKit priming INSIDE the gesture: play → immediate pause on the
      // ONE existing player (no second iframe) — no Firebase writes.
      primeVideo: () => player?.primeForAutoplay(),
      resumeAudio: async () => {
        // Existing single-AudioContext unlock (proceduralBuzzerAudioService).
        const res = await unlockAudioFromUserGesture();
        return res.status === "ready" ? "ok" : "failed";
      },
      syncVideo: () => {
        // Narrow adapter: re-anchor the ONE existing player to the last
        // authoritative snapshot (seek + play/pause exactly once).
        if (latestVideoState) player?.localUnlockSync(latestVideoState, serverOffsetMs);
      },
    });
    const mediaUnlockCard = createMediaUnlockCard(() =>
      localMedia.unlockLocalMediaFromTrustedGesture(),
    );
    const unLocalMedia = localMedia.subscribe((s) => mediaUnlockCard.render(s));

    // iOS/mobile activation screen: BLOCKING overlay until the first
    // activation tap (restricted clients only — never on desktop).
    const mediaActivationOverlay = createMediaActivationOverlay(() =>
      localMedia.unlockLocalMediaFromTrustedGesture(),
    );
    view.root.append(mediaActivationOverlay.root);
    const unLocalActivation = localMedia.subscribe((s) =>
      mediaActivationOverlay.render(s),
    );

    /** DEV-only desktop regression guarantees (§4 of the mobile spec). */
    function assertDesktopMediaTransparency(): void {
      if (!import.meta.env.DEV) return;
      const s = localMedia.getLocalMediaCompatibilityState();
      if (s.mode !== "desktop-compatible") return;
      const visibleGates = document.querySelectorAll(".vb-media-unlock:not([hidden])").length;
      if (visibleGates > 0) {
        console.error("[vb-media] unlock UI mounted in desktop-compatible mode");
      }
      const activationOverlays = document.querySelectorAll(
        ".vb-media-activation:not([hidden])",
      ).length;
      if (activationOverlays > 0) {
        console.error("[vb-media] activation overlay mounted in desktop-compatible mode");
      }
      const players = document.querySelectorAll(".vb-player").length;
      if (players > 1) {
        console.error(`[vb-media] ${players} YouTube players initialized (expected 1)`);
      }
      const kbd = (window as unknown as { __vbKeyboardListeners?: number }).__vbKeyboardListeners;
      if (kbd !== undefined && kbd > 1) {
        console.error(`[vb-media] ${kbd} global keyboard handlers (expected 1)`);
      }
    }

    function ensurePlayer(firstVideoId: string): void {
      if (player) return;
      player = createYoutubePlayer(firstVideoId, {
        isHost,
        onHostAction: hostActionHandler,
        // Additive observers — the desktop sync flow itself is unchanged.
        onPlayerStateChange: (ps) => localMedia.handleYouTubePlayerStateChange(ps),
        onAutoplayBlocked: () => localMedia.handleYouTubeAutoplayBlocked(),
        onAutoplayAttempt: () => localMedia.noteAutoplayAttempt(),
      });
      // The player section is position:absolute within the video shell, so
      // DOM order is irrelevant. NEVER insertBefore the popup region here —
      // it lives OUTSIDE the shell and would throw NotFoundError (code 8).
      view.videoColumn.append(player.root);
      // Local unlock card: normal-flow sibling BELOW the player (restricted
      // clients only render it after an observed block; hidden by default).
      if (!mediaUnlockCard.root.isConnected) {
        view.videoColumn.append(mediaUnlockCard.root);
      }
      videoEmptyState.hidden = true;
    }

    /* Buzzer stage — the former Player Arena zone, now dedicated to the
       large mechanical buzzer (the ONE canonical BUZZ button). Player list,
       presence and host scoring live in the Players panel; the authoritative
       winner popup stays below the video. */
    const stage = createBuzzerStage();
    view.arenaSlot.append(stage.root);

    /* Buzz popup — normal-flow sibling BELOW the video shell. Actions are
       injected later (same handlers as the host panel → no second path). */
    const buzzPopup = createBuzzPopup();
    view.buzzPopupColumn.append(buzzPopup.root);

    /* Buzzer */
    let buzzLock = false;
    let resumeLock = false;
    const buzzPanel = createBuzzPanel({
      onBuzz: () => doBuzz(),
      onHostResume: () => doResume(),
    });
    stage.mountBuzzPanel(buzzPanel.root, buzzPanel.feedbackRoot);

    function doBuzz(): void {
      // Unlock audio synchronously within the user gesture before the RTDB transaction.
      // Do not await; user activation can expire if we await long async tasks.
      void unlockAudioFromUserGesture()
        .then(() => localMedia.noteAudioStatus(getAudioStatus()))
        .catch(() => {});
      // Double-click / repeat protection lives here AND in the transaction.
      if (buzzLock || !buzzPanel.isEnabled()) return;
      buzzLock = true;
      buzzPanel.markPending(true);
      // Neutral pending state — never a winner indication.
      // Neutral local "Buzz sent…" below the video (replaced by the
      // authoritative winner popup once RTDB confirms).
      buzzPopup.setPending(true);

      const videoTime = player?.getPosition() ?? 0;
      attemptBuzz(code, uid, displayName, videoTime)
        .then(() => {
          buzzLock = false;
          buzzPanel.markPending(false);
          buzzPopup.setPending(false);
          // Won/taken UI renders from the authoritative watchRound snapshot.
        })
        .catch(() => {
          // Transaction failed (offline/rule): release the lock, round unchanged.
          buzzLock = false;
          buzzPanel.markPending(false);
          buzzPopup.setPending(false);
        });
    }

    /**
     * THE canonical host action: resume synchronized playback AND open the
     * next buzz round in one clear step. Used by the host's main mechanical
     * buzzer (while the round is 'buzzed') AND by every host control labelled
     * "Resume and open next buzz" (host panel + buzz popup) — never a second
     * write path. Guarantees:
     *   - exactly one round transition (RTDB tx guard: only 'buzzed' commits;
     *     rapid clicks / repeats are also blocked by resumeLock);
     *   - roundNumber incremented exactly once, winner cleared, scores
     *     untouched, video/queue/videoSessionId untouched;
     *   - exactly ONE playback write (requestPlay, seq+1) and only when the
     *     round transaction actually committed;
     *   - a server-anchored global buzz cooldown (350ms) before anyone —
     *     host included — may buzz again.
     */
    function doResume(): void {
      if (resumeLock) return; // rapid pointer/keyboard events: one transition
      if (!isHost) return; // UX guard; Firebase rules are the real authority
      if (latestRound?.state !== "buzzed") return; // never while open/cooldown
      if (!activeVideoId) return; // nothing to resume
      resumeLock = true;
      buzzPanel.markResumePending(true);
      resumeAndOpenNextRound(code, latestVideoSessionId)
        .then((res) => {
          if (!res.committed) return; // duplicate or stale → no playback write
          return requestPlay(code, uid, player?.getPosition() ?? 0);
        })
        .catch(() => undefined)
        .finally(() => {
          resumeLock = false;
          buzzPanel.markResumePending(false);
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


    /* Game sound controls (must not block BUZZ button) */
    const soundPanel = createSoundPanel({
      code,
      uid,
      initialProfileId: null,
    });
    // Place sound controls below the stage but still in sidebar; never covers buzzer.
    // Sound settings live inside the collapsed settings drawer.
    view.settingsContent.append(soundPanel.root);
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

    /* Top-bar sound toggle — canonical audio service, synced with the panel. */
    const syncSoundToggle = (): void => {
      const muted = getAudioPreferences().muted;
      view.soundToggle.textContent = muted ? "🔇" : "🔊";
      view.soundToggle.setAttribute("aria-pressed", String(!muted));
      soundPanel.setMutedState(muted);
    };
    view.soundToggle.addEventListener("click", () => {
      // Gesture: also unlocks audio so unmuting works on first click.
      void unlockAudioFromUserGesture().catch(() => {});
      setMuted(!getAudioPreferences().muted);
      syncSoundToggle();
    });
    syncSoundToggle();

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

    /* Buzz popup action: the ONE canonical doResume() path — (1) close the
       buzzed round into a new cooldown round (roundNumber+1, winner cleared),
       (2) resume playback via exactly one requestPlay. The prior winner key
       is already processed and the round node is replaced, so nothing
       replays. Shared by the buzzer and the popup — no second path. The host
       panel intentionally has no resume/open-next buttons anymore. */
    buzzPopup.setActions({ onResumeAndNext: () => doResume() });

    if (isHost) {
      hostPanel = createHostPanel({
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
      // Host controls live INSIDE the settings drawer (⚙️ Settings &
      // diagnostics) — the sidebar keeps only the player queue.
      view.settingsContent.append(hostPanel.root);
    }

    /* ---------------- Advanced scoring (host, in settings drawer) -------- */
    // Tracks the CURRENT playback session so audit events stay contextual.
    let latestVideoSessionId: number | null = null;

    /* Compact audit feed — hidden by default inside the settings drawer.
       Renders the read-only log only; /scoreEvents persistence stays intact. */
    const scoreFeed = createScoreFeed();
    view.settingsContent.append(scoreFeed.root);

    const scoring = isHost
      ? createManualScoring({
          // Same canonical wrapper as the player rows — no second path.
          onAdjust: (target, delta, reason) => applyScoreAdjust(target.uid, delta, reason),
        })
      : null;
    if (scoring) view.settingsContent.append(scoring.root);

    /* Diagnostics (collapsible, read-only) */
    let lastSyncedPos: number | null = null;
    const diagnostics = createDiagnostics({
      getLocalPosition: () => player?.getPosition() ?? 0,
      getLastSyncedPosition: () => lastSyncedPos,
      onForcePresenceRefresh: () => void presenceService.forcePresenceRefresh(),
    });
    diagnostics.setRole(isHost);
    diagnostics.setRoomCode(code);
    // Diagnostics live inside the settings drawer — never in the default view.
    view.settingsContent.append(diagnostics.root);

    app.replaceChildren(view.root);

    /* Dev-only: verify buzzer button is visible in the initial viewport. */
    if (import.meta.env.DEV) {
      const checkBuzzerVisibility = (): void => {
        const btns = document.querySelectorAll<HTMLButtonElement>(".vb-mechanical-buzzer");
        if (btns.length !== 1) {
          console.warn(`[vb-layout] expected exactly 1 mechanical buzzer, found ${btns.length}`);
          return;
        }
        const btn = btns[0]!;
        const rect = btn.getBoundingClientRect();
        const zone = btn.closest<HTMLElement>(".vb-mechanical-buzzer-zone");
        const zoneRect = zone?.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Primary UX guard: BUZZ must be visible on desktop.
        if (vw >= 1100 && vh >= 720 && (rect.bottom < 0 || rect.top > vh || rect.width === 0 || rect.height === 0)) {
          console.warn(
            `[vb-layout] buzzer button is below the fold at ${vw}×${vh} — ` +
            `getBoundingClientRect: top=${Math.round(rect.top)} bottom=${Math.round(rect.bottom)}`,
          );
        }

        // Geometry diagnostics: circularity, aspect, clipping, overlaps.
        const ratio = rect.height > 0 ? rect.width / rect.height : 0;
        const shadow = btn.querySelector<HTMLElement>(".vb-buzzer-shadow");
        const shadowRect = shadow?.getBoundingClientRect();
        const clippedShadow =
          shadowRect && zoneRect
            ? shadowRect.bottom > zoneRect.bottom + 1 || shadowRect.right > zoneRect.right + 1
            : false;
        const kbdCount = (window as unknown as { __vbKeyboardListeners?: number }).__vbKeyboardListeners;

        console.debug(
          `[vb-buzzer] state=${btn.dataset.state ?? "?"} disabled=${btn.disabled} ` +
          `button=${Math.round(rect.width)}×${Math.round(rect.height)} @(${Math.round(rect.left)},${Math.round(rect.top)}) ` +
          `aspect=${ratio.toFixed(3)} zone=${zoneRect ? `${Math.round(zoneRect.width)}×${Math.round(zoneRect.height)}` : "missing"} ` +
          `shadowClipped=${clippedShadow} buzzerCount=${btns.length} ` +
          `keyListeners=${kbdCount ?? "?"}`,
        );
        if (Math.abs(ratio - 1) > 0.02) {
          console.warn(`[vb-layout] buzzer is not circular (aspect ${ratio.toFixed(3)})`);
        }
        if (clippedShadow) {
          console.warn("[vb-layout] buzzer ground shadow is clipped by its zone");
        }
      };
      // Check after layout settles, and on resize.
      requestAnimationFrame(() => requestAnimationFrame(checkBuzzerVisibility));
      window.addEventListener("resize", checkBuzzerVisibility, { passive: true });
    }

    /* Keyboard shortcuts (Space / Enter / NumpadEnter) */
    let modalOpen = false;
    hostPanel?.onModalOpenChange?.((open: boolean) => { modalOpen = open; });
    if (import.meta.env.DEV) {
      const w = window as unknown as { __vbKeyboardListeners?: number };
      w.__vbKeyboardListeners = (w.__vbKeyboardListeners ?? 0) + 1;
      if (w.__vbKeyboardListeners > 1) {
        console.warn(`[vb-layout] ${w.__vbKeyboardListeners} global keyboard listeners registered`);
      }
    }
    /* Keyboard shortcuts (Space / Enter / NumpadEnter).
       One dispatcher, two canonical actions: while the round is 'buzzed' the
       HOST's shortcut runs doResume(); otherwise doBuzz(). No double
       invocation: when the buzzer button itself is focused, keyboard-buzz
       excludes BUTTON (native click handles it exactly once); otherwise this
       global listener fires exactly once per keydown and the doBuzz/doResume
       locks guard re-entry. In cooldown / offline / no-video / pending states
       neither action is available, so the shortcut does nothing. */
    const unKeyboard = setupKeyboardBuzz({
      getState: () => ({
        buzzEnabled:
          buzzPanel.isEnabled() || buzzPanel.isResumeActionAvailable(),
        connected: localConnected,
        modalOpen,
      }),
      onBuzz: () => {
        if (buzzPanel.isResumeActionAvailable()) doResume();
        else doBuzz();
      },
      onDebug: import.meta.env.DEV ? (msg) => console.debug(msg) : undefined,
    });

    /* Live subscriptions */
    let localConnected = true;
    let serverOffsetMs = 0;
    let stopHeartbeat: (() => void) | null = null;
    let lastAutoPausedRound = -1;
    // Cooldown instance already handed to completeCooldown (host only).
    let lastCooldownKey = "";
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

    // Winner identity/color rendering lives entirely in the buzz popup
    // (.vb-buzz-popup-region) — the Buzzer zone carries no winner metadata.

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
        stage.setRoomData(list, latestRound, uid);
        scoring?.setParticipants(list);
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

    // Capped audit feed (most recent 50) — read-only for everyone.
    const unScoreEvents = onValue(
      query(ref(db, scoreEventsPath(code)), limitToLast(50)),
      (snap) => {
        const events: ScoreEvent[] = [];
        snap.forEach((child) => {
          const v = child.val();
          if (v && typeof v === "object") events.push(v as ScoreEvent);
        });
        scoreFeed.setEvents(events.reverse()); // newest first
      },
    );

    /* ---------------- Video queue (canonical, host-managed) ---------------- */

    // Player read-only queue summary — scoreboard section of the sidebar.
    const playerQueue = createPlayerQueue();
    view.sidebar.insertBefore(playerQueue.root, view.sidebar.querySelector(".vb-settings-drawer"));

    let latestQueueSnapshot: VideoQueueSnapshot | null = null;

    function launchById(itemId: string, autoplay: boolean): Promise<void> {
      if (!isHost) return Promise.resolve(); // UX guard; rules are the real authority
      // Returned so the queue panel's busy guard spans the actual write.
      return launchQueueItem(code, uid, itemId, { autoplay }).catch((err) => {
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

    /* ---------------- DEV-only buzzer geometry assertion ----------------
       The Buzzer zone must be geometrically stable across all round states.
       Measures .vb-mechanical-buzzer with getBoundingClientRect and warns
       when width/height/x/y drift by more than 1px (viewport-size changes
       are exempt). Also asserts no metadata element is mounted inside the
       buzzer zone and the popup region never sits inside the video shell.
       Compiled out in production. */
    let lastBuzzerRect: { w: number; h: number; x: number; y: number; vw: number; vh: number } | null = null;
    function checkBuzzerGeometry(trigger: string): void {
      if (!import.meta.env.DEV) return;
      const btn = document.querySelector<HTMLElement>(".vb-mechanical-buzzer");
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (lastBuzzerRect && lastBuzzerRect.vw === vw && lastBuzzerRect.vh === vh) {
        const drift = [
          Math.abs(r.width - lastBuzzerRect.w),
          Math.abs(r.height - lastBuzzerRect.h),
          Math.abs(r.x - lastBuzzerRect.x),
          Math.abs(r.y - lastBuzzerRect.y),
        ];
        if (drift.some((d) => d > 1)) {
          console.error(
            `[vb-layout] BUZZER GEOMETRY SHIFT at ${trigger}: ` +
              `was ${lastBuzzerRect.w.toFixed(1)}×${lastBuzzerRect.h.toFixed(1)} @(${lastBuzzerRect.x.toFixed(1)},${lastBuzzerRect.y.toFixed(1)}) ` +
              `now ${r.width.toFixed(1)}×${r.height.toFixed(1)} @(${r.x.toFixed(1)},${r.y.toFixed(1)})`,
          );
        }
      }
      lastBuzzerRect = { w: r.width, h: r.height, x: r.x, y: r.y, vw, vh };

      // Structural invariants: no metadata inside the buzzer zone; popup
      // region is a sibling of (never inside) the video shell.
      const zone = btn.closest<HTMLElement>(".vb-mechanical-buzzer-zone");
      for (const sel of [".vb-winner-card", ".vb-paused-pill", ".vb-buzz-round-pill"]) {
        if (zone?.querySelector(sel)) {
          console.error(`[vb-layout] metadata element ${sel} mounted inside the buzzer zone`);
        }
      }
      const popupRegion = document.querySelector<HTMLElement>(".vb-buzz-popup-region");
      if (popupRegion?.closest(".vb-video-shell")) {
        console.error("[vb-layout] .vb-buzz-popup-region is inside .vb-video-shell");
      }
    }

    const unRound = watchRound(code, (round) => {
      latestRound = round;
      buzzPanel.setRound(round);
      hostPanel?.setRound(round);
      diagnostics.setRound(round);
      view.setRoundStatus(round.state);
      stage.setRoomData(participants, round, uid);

      // DEV-only layout-stability assertion: the mechanical buzzer must keep
      // the same bounding rectangle (±1px) across EVERY round transition
      // (buzz, host resume, next round, cooldown, reconnect snapshot).
      checkBuzzerGeometry(`round:${round.state}#${round.number}`);

      // Global cooldown expiry (host only): normalize the round back to
      // 'open' once the SERVER-anchored window elapses. Derived from this
      // live authoritative snapshot (reconnect-safe), not from a pre-armed
      // timer as a source of truth. completeCooldown re-verifies state
      // inside its transaction, so stale timers (e.g. video changed during
      // cooldown) are harmless no-ops. Even if the host tab vanishes, the
      // attemptBuzz transaction still accepts cooldown rounds past expiry.
      if (
        isHost &&
        round.state === "cooldown" &&
        typeof round.cooldownStartedAt === "number"
      ) {
        const key = `${round.number}:${round.cooldownStartedAt}`;
        if (key !== lastCooldownKey) {
          lastCooldownKey = key;
          const remainingMs =
            round.cooldownStartedAt + RESUME_BUZZ_COOLDOWN_MS -
            (Date.now() + serverOffsetMs);
          if (remainingMs <= 0) {
            void completeCooldown(code).catch(() => undefined);
          } else {
            window.setTimeout(
              () => void completeCooldown(code).catch(() => undefined),
              remainingMs,
            );
          }
        }
      }

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

        // Popup below the video — same authoritative source, same static rule
        // for late joiners / refresh / stale sessions.
        const winnerView = participants.find((p) => p.uid === round.buzz!.playerId);
        buzzPopup.show({
          buzzEventKey: buzzKey,
          roundNumber: round.number,
          winnerId: round.buzz.playerId,
          winnerName: round.buzz.displayName,
          winnerColor: winnerView?.color ?? "#64748b",
          isWinnerYou: round.buzz.playerId === uid,
          isHost,
          videoPaused: true,
          animate: !renderStatic,
          buzzedAt: typeof round.buzz.buzzedAt === "number" ? round.buzz.buzzedAt : null,
          videoTime: typeof round.buzz.videoTime === "number" ? round.buzz.videoTime : null,
          serverOffsetMs,
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
        buzzPopup.hide(
          round.state === "open"
            ? "round opened (next buzz)"
            : `round state ${round.state}`,
        );
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
      const prevSession = activeSessionFingerprint;
      activeVideoId = vid;
      activeSessionFingerprint = `${vid}:${state?.videoSessionId ?? 0}`;
      latestVideoSessionId = vid ? state?.videoSessionId ?? null : null;
      // Video session change invalidates any stale popup instantly (a launch
      // also flips the round to "open" via its own watcher → double safety).
      if (prevSession !== activeSessionFingerprint) buzzPopup.hide("video session changed");

      // Lazy player creation on the first real video; switch-to-video itself
      // is handled inside the player via the same remote snapshot (seq-guarded).
      if (vid) ensurePlayer(vid);

      refreshBuzzGate();
      player?.applyRemote(state, serverOffsetMs);
      // Local compatibility layer (read-only): desktop clients stay fully
      // transparent; restricted clients react only to an OBSERVED block.
      latestVideoState = vid ? state : null;
      localMedia.handleAuthoritativePlayback({
        playing: !!state?.playing,
        videoId: vid,
        seq: state?.seq ?? 0,
      });
      assertDesktopMediaTransparency();
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
      if (import.meta.env.DEV) {
        const w = window as unknown as { __vbKeyboardListeners?: number };
        w.__vbKeyboardListeners = Math.max(0, (w.__vbKeyboardListeners ?? 1) - 1);
      }
      unKeyboard();
      unLocalMedia();
      unLocalActivation();
      mediaUnlockCard.dispose();
      mediaActivationOverlay.dispose();
      unParticipants();
      unPresenceDebug();
      unScoreEvents();
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
