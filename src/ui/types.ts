import type { ParticipantView } from "../types/participant";

export type { ParticipantView };

export interface EntryViewCallbacks {
  /** Called with the raw YouTube URL after the view validated its format. */
  onCreateRoom(youtubeUrl: string, name: string): void;
  /** Called with an uppercase room code extracted from a code or share link. */
  onJoinRoom(code: string, name: string): void;
}

export interface RoomViewHandles {
  root: HTMLElement;
  /** Video region inside the primary column (player mounts here). */
  videoColumn: HTMLElement;
  /** Primary-column actions area under the video (buzzer mounts here). */
  primaryColumn: HTMLElement;
  /** Sidebar (host controls, scoreboard, diagnostics). */
  sidebar: HTMLElement;
  setParticipants(list: ParticipantView[]): void;
  setConnectionState(online: boolean): void;
  setRoundStatus(state: string | null): void;
  setPlayerCount(online: number, total: number): void;
}
