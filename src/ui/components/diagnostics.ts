import type { RoundData } from "../../types";
import { formatTime } from "./youtube-player";

export interface DiagnosticsHandles {
  root: HTMLElement;
  setConnection(online: boolean): void;
  setRole(isHost: boolean): void;
  setRoomCode(code: string): void;
  setRound(round: RoundData | null): void;
  setAuthUid(uid: string | null): void;
  setServerOffset(ms: number): void;
  setPresenceInfo(info: { path: string; value: string }): void;
  dispose(): void;
}

/**
 * Collapsible read-only panel with live session facts (connection state,
 * role, roomId, roundNumber, local position, last synchronized position,
 * auth uid and the canonical presence path/value).
 */
export function createDiagnostics(opts: {
  getLocalPosition(): number;
  getLastSyncedPosition(): number | null;
  /** DEV-only: re-arms + rewrites presence (button rendered in dev builds). */
  onForcePresenceRefresh?(): void;
}): DiagnosticsHandles {
  const root = document.createElement("details");
  root.className = "vb-diag";

  const summary = document.createElement("summary");
  summary.textContent = "Diagnostics";

  const grid = document.createElement("div");
  grid.className = "vb-diag-grid";

  const makeRow = (label: string): HTMLElement => {
    const labelEl = document.createElement("span");
    labelEl.className = "vb-diag-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "vb-diag-value";
    valueEl.textContent = "—";
    grid.append(labelEl, valueEl);
    return valueEl;
  };

  const connectionValue = makeRow("Connection");
  const roleValue = makeRow("Role");
  const roomValue = makeRow("Room");
  const roundValue = makeRow("Round");
  const authUidValue = makeRow("Auth UID");
  const serverOffsetValue = makeRow("Server offset");
  const presencePathValue = makeRow("Presence path");
  const presenceValueValue = makeRow("Presence value");
  const localPosValue = makeRow("Local position");
  const lastSyncValue = makeRow("Last synced position");

  root.append(summary, grid);

  if (import.meta.env.DEV && opts.onForcePresenceRefresh) {
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "vb-btn vb-btn--ghost vb-btn--small";
    refreshBtn.textContent = "Force presence refresh";
    refreshBtn.addEventListener("click", () => opts.onForcePresenceRefresh?.());
    root.append(refreshBtn);
  }

  // Position rows are time-varying; refresh them locally at low frequency.
  const ticker = window.setInterval(() => {
    localPosValue.textContent = formatTime(opts.getLocalPosition());
    const sync = opts.getLastSyncedPosition();
    lastSyncValue.textContent = sync === null ? "—" : formatTime(sync);
  }, 500);

  return {
    root,
    setConnection(online) {
      connectionValue.textContent = online ? "Connected" : "Connection lost";
      connectionValue.classList.toggle("vb-diag-bad", !online);
    },
    setRole(isHost) {
      roleValue.textContent = isHost ? "Host" : "Player";
    },
    setRoomCode(code) {
      roomValue.textContent = code;
    },
    setRound(round) {
      roundValue.textContent = round ? `#${round.number} · ${round.state}` : "—";
    },
    setAuthUid(uid) {
      authUidValue.textContent = uid ?? "—";
    },
    setServerOffset(ms) {
      serverOffsetValue.textContent = `${ms >= 0 ? "+" : ""}${ms} ms`;
    },
    setPresenceInfo(info) {
      presencePathValue.textContent = info.path;
      presenceValueValue.textContent = info.value;
    },
    dispose() {
      window.clearInterval(ticker);
    },
  };
}
