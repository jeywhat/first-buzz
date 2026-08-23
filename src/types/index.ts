import type { RoomCode, UserId } from "./common";
import type { PlayerRecord, RoomMeta } from "./player";
import type { GameData } from "./round";
import type { VideoState } from "./video";

export type { RoomCode, UserId };
export type {
  GameStatus,
  RoundState,
  RoundResult,
  Buzz,
  RoundData,
  GameData,
} from "./round";
export { ROUND_STATES, isRoundState } from "./round";
export type { VideoState } from "./video";
export type { RoomMeta, PlayerProfile, PlayerRecord } from "./player";
export { PLAYER_COLORS } from "./player";
export type { ParticipantView, PresenceRecord, PresenceState } from "./participant";

/** Full shape of /rooms/{roomId}. `players` may be absent before anyone joins. */
export interface RoomData {
  meta: RoomMeta;
  video: VideoState;
  game: GameData;
  players?: Record<UserId, PlayerRecord>;
}
