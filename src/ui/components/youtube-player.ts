import type { VideoState } from "../../types";
import {
  computeExpectedPositionSec,
  isStaleSequence,
  shouldSeekTo,
} from "../../lib/video-sync";

export type HostAction = "play" | "pause" | "restart" | "seek";

export interface YoutubePlayerHandles {
  root: HTMLElement;
  /**
   * Applies an authoritative Firebase state. Echoes of locally-initiated
   * changes are filtered by sequence number, so no write-backs happen.
   */
  applyRemote(state: VideoState, serverOffsetMs: number): void;
  /** Current local playback position (for host writes/heartbeats). */
  getPosition(): number;
  /** Pauses the local player without writing to Firebase (buzz reflex). */
  pauseLocal(): void;
  /** Hard re-anchor to the last known authoritative state (reconnect/manual). */
  forceResync(): void;
  dispose(): void;
}

/** Maps YouTube player error codes to readable messages. */
const ERROR_MESSAGES: Record<number, string> = {
  2: "This video id is invalid.",
  5: "The video cannot be played in this browser.",
  100: "This video is unavailable.",
  101: "The owner of this video does not allow embedding.",
  150: "The owner of this video does not allow embedding.",
};

let apiPromise: Promise<void> | null = null;

/** Loads the official IFrame API script exactly once per page. */
function loadIframeApi(): Promise<void> {
  apiPromise ??= new Promise<void>((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const win = window as unknown as { onYouTubeIframeAPIReady?: () => void };
    const previous = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.append(script);
  });
  return apiPromise;
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export { formatTime };

/**
 * Dev-only rendering diagnostics (black-video investigations): logs the
 * iframe src, geometry and the compositing-relevant computed styles of the
 * iframe and its ancestors. Compiled out of production builds.
 */
function debugPlayer(
  stage: string,
  frame: HTMLElement,
  player: YT.Player | null,
  extra?: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return;
  const pick = (el: Element): Record<string, string | number> => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      display: cs.display,
      position: cs.position,
      transform: cs.transform,
      filter: cs.filter,
      opacity: cs.opacity,
      overflow: cs.overflow,
      zIndex: cs.zIndex,
      background: cs.backgroundColor,
    };
  };
  const iframe = frame.querySelector("iframe");
  console.debug(`[vb-player] ${stage}`, {
    ...extra,
    readyState: player?.getPlayerState?.(),
    iframeSrc: iframe?.getAttribute("src") ?? "(no iframe yet)",
    iframe: iframe ? pick(iframe) : null,
    frame: pick(frame),
    body: pick(document.body),
  });
}

export function createYoutubePlayer(
  videoId: string,
  opts: {
    isHost: boolean;
    onHostAction(action: HostAction, positionSec: number): void;
  },
): YoutubePlayerHandles {
  /* ---------- DOM ---------- */

  const root = document.createElement("section");
  root.className = "vb-player";

  // SHELL — never transformed/clipped: a clipped (border-radius+overflow)
  // ancestor around a composited YouTube iframe triggers the black-video
  // bug (audio plays, frames stop painting). Decorative rounding lives on a
  // non-clipping ::after ring instead. See .vb-video-frame in styles.css.
  const frame = document.createElement("div");
  frame.className = "vb-video-frame";

  // The API replaces this node with the iframe itself. Re-created on retry.
  let mount: HTMLDivElement = document.createElement("div");
  mount.className = "vb-video-mount";

  // Blocks native click/keyboard control inside the iframe for everyone:
  // every state change must flow through Firebase, never through the iframe.
  const shield = document.createElement("div");
  shield.className = "vb-video-shield";
  shield.title = "Playback is controlled by the host";

  // Loading feedback is a real transient state: mounted while the player
  // loads, removed from the DOM once ready — never toggled via [hidden].
  let loading: HTMLDivElement | null = document.createElement("div");
  loading.className = "vb-video-loading";
  loading.textContent = "Loading player…";

  frame.append(mount, shield, loading);
  root.append(frame);

  // NOTE: there is NO permanently mounted error layer. .vb-video-error is
  // created inside showVideoError() and removed entirely in
  // clearVideoError(), so an inactive overlay can never cover the iframe.

  let videoError: string | null = null;

  function showLoading(): void {
    if (loading === null) {
      loading = document.createElement("div");
      loading.className = "vb-video-loading";
      loading.textContent = "Loading player…";
      frame.append(loading);
    }
  }

  function removeLoading(): void {
    loading?.remove();
    loading = null;
  }

  function clearVideoError(): void {
    videoError = null;
    frame.querySelectorAll(":scope > .vb-video-error").forEach((el) => el.remove());
  }

  function showVideoError(message: string): void {
    videoError = message;
    clearVideoError(); // never stack duplicates

    const box = document.createElement("div");
    box.className = "vb-video-error";
    box.setAttribute("role", "alert");
    box.setAttribute("aria-live", "assertive");

    const title = document.createElement("h2");
    title.textContent = "Video unavailable";

    const text = document.createElement("p");
    text.textContent = message;

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "vb-btn vb-btn--ghost vb-btn--small";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => {
      void retryPlayer();
    });

    box.append(title, text, retry);
    frame.append(box); // intentional overlay, present only while active
  }

  /** DEV-only: no stale/inactive error layer may exist on a ready player. */
  function assertNoStaleErrorOverlay(): void {
    if (!import.meta.env.DEV) return;
    const stale = frame.querySelector(":scope > .vb-video-error");
    if (stale === null || videoError !== null) return;
    const cs = getComputedStyle(stale);
    console.warn(
      "[vb-player] .vb-video-error exists with no active error",
      {
        hiddenAttr: stale.hasAttribute("hidden"),
        computedDisplay: cs.display,
        classes: stale.className,
        zIndex: cs.zIndex,
        background: cs.backgroundColor,
      },
    );
  }

  /* ---------- Host controls ---------- */

  let toggleBtn: HTMLButtonElement | null = null;
  let slider: HTMLInputElement | null = null;
  let timeLabel: HTMLElement | null = null;

  if (opts.isHost) {
    const controls = document.createElement("div");
    controls.className = "vb-controls";

    toggleBtn = document.createElement("button");
    toggleBtn.className = "vb-btn vb-btn--ghost vb-btn--small vb-toggle";
    toggleBtn.textContent = "Play";

    const restartBtn = document.createElement("button");
    restartBtn.className = "vb-btn vb-btn--ghost vb-btn--small";
    restartBtn.textContent = "⟲ Restart";

    slider = document.createElement("input");
    slider.className = "vb-slider";
    slider.type = "range";
    slider.min = "0";
    slider.max = "0"; // filled once metadata loads
    slider.step = "1";
    slider.value = "0";
    slider.setAttribute("aria-label", "Seek");

    timeLabel = document.createElement("span");
    timeLabel.className = "vb-time";
    timeLabel.textContent = "0:00 / 0:00";

    toggleBtn.addEventListener("click", () => {
      if (!player || !ready) return;
      const pos = safeCurrentTime() ?? 0;
      const ps = player.getPlayerState();
      const playingNow = ps === YT.PlayerState.PLAYING || ps === YT.PlayerState.BUFFERING;
      opts.onHostAction(playingNow ? "pause" : "play", pos);
    });

    restartBtn.addEventListener("click", () => {
      if (!ready) return;
      opts.onHostAction("restart", 0);
    });

    // While dragging, preview the label but only emit one action on release.
    slider.addEventListener("input", () => {
      draggingRef.value = true;
      updateTimeLabel(Number(slider!.value), Number(slider!.max) || 0);
    });
    slider.addEventListener("change", () => {
      draggingRef.value = false;
      if (ready) opts.onHostAction("seek", Number(slider!.value));
    });

    controls.append(toggleBtn, restartBtn, slider, timeLabel);
    root.append(controls);
  }

  /* ---------- Player lifecycle ---------- */

  // Shared with slider drag handlers so the ticker never fights the user.
  const draggingRef: { value: boolean } = { value: false };

  let player: YT.Player | null = null;
  let ready = false;
  let disposed = false;
  let retrying = false;
  let appliedSeq = 0;
  let didInitialSync = false;
  let serverOffsetMs = 0;
  let pendingState: VideoState | null = null;
  let ticker = 0;
  let layoutObserver: ResizeObserver | null = null;
  let devWidthWarning: HTMLDivElement | null = null;

  /**
   * Re-tells the YouTube player how big the iframe actually is. YT sizes its
   * internal video surface from the iframe box, and that box changes when the
   * room reflows (scrollbar appearing, sidebar wrapping, window resize).
   * setSize() is the API's sanctioned way to re-sync — no business behavior.
   */
  function applyPlayerSize(): void {
    if (!player || !ready) return;
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (w > 0 && h > 0) player.setSize(w, h);
  }

  /** DEV-only: console.table dump of the whole player layout chain. */
  function logLayoutTable(): void {
    if (!import.meta.env.DEV) return;
    const rows: Array<Record<string, string | number>> = [];
    const collect = (name: string, el: Element | null): void => {
      if (!el) return;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      rows.push({
        element: name,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        display: cs.display,
        position: cs.position,
        flex: cs.flex,
        flexBasis: cs.flexBasis,
        minWidth: cs.minWidth,
        maxWidth: cs.maxWidth,
        gridColumn: cs.gridColumn,
        transform: cs.transform,
        overflow: cs.overflow,
      });
    };
    collect("iframe", frame.querySelector("iframe"));
    collect("target(mount)", frame.querySelector(".vb-video-mount"));
    collect("player-shell", frame);
    collect("video-column", frame.parentElement);
    collect("room-layout", frame.parentElement?.parentElement ?? null);
    collect("room", frame.closest(".vb-room"));
    collect("app-root", document.getElementById("app"));
    console.table(rows);
  }

  /** DEV-only: visible warning when the shell drops below 200px wide. */
  function checkDevShellWidth(): void {
    if (!import.meta.env.DEV) return;
    const width = frame.clientWidth;
    const tooSmall = width > 0 && width < 200;
    if (tooSmall && devWidthWarning === null) {
      devWidthWarning = document.createElement("div");
      devWidthWarning.className = "vb-dev-width-warning";
      devWidthWarning.textContent = `[vb-player] shell width ${width}px (<200px) — layout collapsed`;
      document.body.append(devWidthWarning);
    } else if (!tooSmall && devWidthWarning !== null) {
      devWidthWarning.remove();
      devWidthWarning = null;
    }
  }

  /** Tracks the shell so setSize runs on ANY size change (not just window). */
  function attachLayoutObserver(): void {
    layoutObserver ??= new ResizeObserver(() => {
      applyPlayerSize();
      logLayoutTable();
      checkDevShellWidth();
    });
    layoutObserver.observe(frame);
  }

  /**
   * Resolves once the shell has a real, non-zero box. One rAF lets the freshly
   * attached tree compute layout; if it still has no box (hidden tab, pending
   * grid track), a ResizeObserver waits — no arbitrary timeouts.
   */
  async function waitForShellLayout(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (frame.clientWidth > 0 && frame.clientHeight > 0) return;
    await new Promise<void>((resolve) => {
      const observer = new ResizeObserver(() => {
        if (frame.clientWidth > 0 && frame.clientHeight > 0) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(frame);
    });
  }

  function safeCurrentTime(): number | null {
    if (!player || !ready) return null;
    const t = player.getCurrentTime();
    return Number.isFinite(t) ? t : null;
  }

  function updateTimeLabel(currentSec: number, durationSec: number): void {
    if (!timeLabel) return;
    timeLabel.textContent = `${formatTime(currentSec)} / ${formatTime(durationSec)}`;
  }

  function syncControlsFromPlayer(): void {
    if (!player || !ready || !toggleBtn || !slider) return;
    const ps = player.getPlayerState();
    const playing = ps === YT.PlayerState.PLAYING || ps === YT.PlayerState.BUFFERING;
    toggleBtn.textContent = playing ? "Pause" : "Play";

    const duration = player.getDuration();
    if (duration > 0 && slider.max === "0") slider.max = String(Math.floor(duration));

    const current = safeCurrentTime();
    if (current !== null && !draggingRef.value) {
      slider.value = String(Math.floor(current));
      updateTimeLabel(current, duration);
    }
  }

  function applyLatest(): void {
    const state = pendingState;
    if (!state || !player || !ready) return;
    if (isStaleSequence(state.seq, appliedSeq)) return;
    appliedSeq = state.seq;

    const target = computeExpectedPositionSec(state, Date.now() + serverOffsetMs);
    const current = safeCurrentTime();

    if (!didInitialSync) {
      // Startup / late-join anchor: snap once to the authoritative position
      // even while paused — a joiner of a paused room must not start at 0:00.
      didInitialSync = true;
      if (current !== null && Math.abs(current - target) > 0.05) {
        player.seekTo(target, true);
      }
    } else if (state.playing) {
      // Live drift correction only runs while playing; never nudge a paused frame.
      if (current !== null && shouldSeekTo(current, target)) {
        player.seekTo(target, true);
      }
    }

    const ps = player.getPlayerState();
    if (
      state.playing &&
      ps !== YT.PlayerState.PLAYING &&
      ps !== YT.PlayerState.BUFFERING
    ) {
      player.playVideo();
    }
    if (
      !state.playing &&
      (ps === YT.PlayerState.PLAYING || ps === YT.PlayerState.BUFFERING)
    ) {
      player.pauseVideo();
    }
    syncControlsFromPlayer();
  }

  /**
   * Creates the YT player against the settled shell. Re-runnable: retry()
   * destroys the old instance, clears the error layer and calls this again.
   */
  async function initPlayer(): Promise<void> {
    if (disposed) return;
    // The container must be visible with non-zero dimensions BEFORE the API
    // creates the iframe; otherwise YT bakes a stale internal video surface.
    await loadIframeApi();
    await waitForShellLayout();
    if (disposed) return;

    // Remove any old error layer BEFORE (re)initializing the player.
    clearVideoError();
    showLoading();

    player = new YT.Player(mount, {
      videoId,
      // No width/height options: the stable shell + CSS (absolute, inset:0,
      // 100%/100%) control the generated iframe, and setSize() keeps YT's
      // internal surface in sync with the shell on every reflow.
      playerVars: {
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        disablekb: 1,
        controls: 0, // no native controls bar; host uses app controls
      },
      events: {
        onReady: () => {
          if (disposed) return;
          ready = true;
          removeLoading();
          applyPlayerSize();
          attachLayoutObserver();
          logLayoutTable();
          checkDevShellWidth();
          assertNoStaleErrorOverlay();
          debugPlayer("ready", frame, player);
          applyLatest();
        },
        onError: (event) => {
          removeLoading();
          showVideoError(
            ERROR_MESSAGES[event.data] ?? "The video cannot be played.",
          );
          debugPlayer("error", frame, player, { ytErrorCode: event.data });
        },
        onStateChange: () => syncControlsFromPlayer(),
      },
    });
    debugPlayer("constructed", frame, player);

    window.clearInterval(ticker);
    ticker = window.setInterval(syncControlsFromPlayer, 500);
  }

  /** Destroys the current instance and re-initializes the player. */
  async function retryPlayer(): Promise<void> {
    if (disposed || retrying) return;
    retrying = true;
    clearVideoError();
    window.clearInterval(ticker);
    try {
      player?.destroy();
    } catch {
      // Player may already be gone.
    }
    player = null;
    ready = false;
    didInitialSync = false; // fresh anchor against the authoritative state
    // The API replaced the old mount with the (now removed) iframe: create a
    // fresh target so the new player has a node to replace.
    mount = document.createElement("div");
    mount.className = "vb-video-mount";
    frame.prepend(mount);
    showLoading();
    await initPlayer();
    retrying = false;
  }

  void initPlayer();

  /* ---------- Public surface ---------- */

  return {
    root,
    applyRemote(state, offsetMs) {
      serverOffsetMs = offsetMs;
      pendingState = state;
      applyLatest();
    },
    getPosition() {
      return safeCurrentTime() ?? 0;
    },
    pauseLocal() {
      if (!player || !ready) return;
      const ps = player.getPlayerState();
      if (ps === YT.PlayerState.PLAYING || ps === YT.PlayerState.BUFFERING) {
        player.pauseVideo();
      }
    },
    forceResync() {
      // Reconnects leave seq unchanged, so the stale-guard would skip the
      // next snapshot; this snaps immediately using the last known state.
      if (!pendingState || !player || !ready) return;
      const target = computeExpectedPositionSec(pendingState, Date.now() + serverOffsetMs);
      const current = safeCurrentTime();
      if (current !== null && Math.abs(current - target) > 0.05) {
        player.seekTo(target, true);
      }
      const ps = player.getPlayerState();
      const playingNow = ps === YT.PlayerState.PLAYING || ps === YT.PlayerState.BUFFERING;
      if (pendingState.playing && !playingNow) player.playVideo();
      if (!pendingState.playing && playingNow) player.pauseVideo();
      syncControlsFromPlayer();
    },
    dispose() {
      disposed = true;
      retrying = false;
      window.clearInterval(ticker);
      layoutObserver?.disconnect();
      layoutObserver = null;
      devWidthWarning?.remove();
      devWidthWarning = null;
      clearVideoError();
      removeLoading();
      try {
        player?.destroy();
      } catch {
        // Player may already be gone (navigation).
      }
    },
  };
}
