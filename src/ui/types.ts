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
  /** Video SHELL — the neutral mount point for the YouTube player. */
  videoColumn: HTMLElement;
  /** Buzz popup region AFTER the shell — normal flow sibling, never an overlay. */
  buzzPopupColumn: HTMLElement;
  /** Player Arena slot — first card of the game sidebar (hosts the buzzer). */
  arenaSlot: HTMLElement;
  /** Content node of the collapsed settings/diagnostics drawer. */
  settingsContent: HTMLElement;
  /** Video meta chip (shows queue item label / round state). */
  titleChip: HTMLElement;
  /** Top-bar sound toggle (wired to the canonical audio service in main.ts). */
  soundToggle: HTMLButtonElement;
  /** Header identity elements (current user). */
  identity: {
    root: HTMLElement;
    avatar: HTMLElement;
    name: HTMLElement;
    score: HTMLElement;
  };
  sidebar: HTMLElement;
  setParticipants(list: ParticipantView[]): void;
  setConnectionState(online: boolean): void;
  setRoundStatus(state: string | null): void;
  setPlayerCount(online: number, total: number): void;
}
