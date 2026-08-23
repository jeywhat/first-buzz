/** Shared primitive identifiers. */

/** Firebase Auth uid. */
export type UserId = string;

/**
 * Short shareable room identifier: 6 chars from an unambiguous alphabet
 * (no 0/O/1/I). See generateRoomCode() in src/lib/rooms.ts.
 */
export type RoomCode = string;
