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
  /** Insertion point above the code card (player, buzzer). */
  bodyTop: HTMLElement;
  setParticipants(list: ParticipantView[]): void;
  setConnectionState(online: boolean): void;
  /** Always-visible round status pill (idle/open/buzzed/resolved/finished). */
  setRoundStatus(state: string | null): void;
}
