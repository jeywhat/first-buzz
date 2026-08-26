import type { RoomCode, UserId } from "../types";

/** Single source of truth for every RTDB path. Keeps rules and code aligned. */
export const roomPath = (code: RoomCode): string => `rooms/${code}`;
export const roomMetaPath = (code: RoomCode): string => `${roomPath(code)}/meta`;
export const roomVideoPath = (code: RoomCode): string => `${roomPath(code)}/video`;
export const roomGamePath = (code: RoomCode): string => `${roomPath(code)}/game`;
export const roomRoundPath = (code: RoomCode): string => `${roomGamePath(code)}/round`;

export const playersPath = (code: RoomCode): string => `${roomPath(code)}/players`;
export const playerProfilePath = (code: RoomCode, uid: UserId): string =>
  `${playersPath(code)}/${uid}/profile`;
export const playerScorePath = (code: RoomCode, uid: UserId): string =>
  `${playersPath(code)}/${uid}/score`;
export const playerSoundProfilePath = (code: RoomCode, uid: UserId): string =>
  `${playersPath(code)}/${uid}/soundProfileId`;

/** Canonical host-owned video queue at /rooms/{id}/videoQueue. */
export const queuePath = (code: RoomCode): string => `${roomPath(code)}/videoQueue`;
export const queueItemsPath = (code: RoomCode): string => `${queuePath(code)}/items`;
export const queueItemPath = (code: RoomCode, itemId: string): string =>
  `${queueItemsPath(code)}/${itemId}`;
export const queueActiveItemPath = (code: RoomCode): string =>
  `${queuePath(code)}/activeItemId`;
export const queueRevisionPath = (code: RoomCode): string =>
  `${queuePath(code)}/revision`;

export const presenceRoomPath = (code: RoomCode): string => `presence/${code}`;
export const presenceUserPath = (code: RoomCode, uid: UserId): string =>
  `${presenceRoomPath(code)}/${uid}`;
