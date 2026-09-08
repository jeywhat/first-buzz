import { get, onValue, ref, set, type Unsubscribe } from "firebase/database";
import {
  DEFAULT_BUZZER_SOUND,
  isValidBuzzerSoundId,
  type BuzzerSoundId,
} from "./buzzer-sounds";
import { getFirebaseDatabase } from "./firebase";
import { buzzerSoundPath, profilesPath } from "./paths";
import type { UserId } from "../types";

/**
 * Global per-user buzzer sound — room-INDEPENDENT by design.
 *
 * Source of truth: /profiles/{uid}/buzzerSound (RTDB). Every client keeps a
 * live cache via one listener, so when someone buzzes, every speaker can play
 * the WINNER's chosen sound. localStorage mirrors the LOCAL user's choice for
 * instant UI before the network answers.
 */

const LS_BUZZER_SOUND = "vb-buzzer-sound";

const cache = new Map<UserId, BuzzerSoundId>();

export function loadLocalBuzzerSound(): BuzzerSoundId | null {
  try {
    const raw = localStorage.getItem(LS_BUZZER_SOUND);
    return isValidBuzzerSoundId(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveLocalBuzzerSound(id: BuzzerSoundId): void {
  try {
    localStorage.setItem(LS_BUZZER_SOUND, id);
  } catch {
    // storage unavailable — RTDB remains the shared source of truth
  }
}

/** Cached sound for a user (winner lookup); falls back to the factory default. */
export function getBuzzerSound(uid: UserId): BuzzerSoundId {
  return cache.get(uid) ?? loadLocalBuzzerSound() ?? DEFAULT_BUZZER_SOUND;
}

/**
 * Subscribes to ALL profiles (tiny node: one string per user). Rebuilds the
 * cache on every change so winner lookups stay fresh without per-buzz reads.
 */
export function watchBuzzerSounds(onChange?: () => void): Unsubscribe {
  const db = getFirebaseDatabase();
  return onValue(ref(db, profilesPath()), (snap) => {
    cache.clear();
    snap.forEach((child) => {
      const uid = child.key;
      const sound = child.child("buzzerSound").val();
      if (uid && isValidBuzzerSoundId(sound)) cache.set(uid, sound);
    });
    onChange?.();
  });
}

/**
 * Ensures the local user has a buzzer sound in RTDB: keeps the existing
 * remote choice, otherwise writes the local choice or the factory default.
 * Safe to call once per room entry; fire-and-forget friendly.
 */
export async function ensureBuzzerSound(uid: UserId): Promise<BuzzerSoundId> {
  const db = getFirebaseDatabase();
  const snap = await get(ref(db, buzzerSoundPath(uid)));
  const remote = snap.val();
  if (isValidBuzzerSoundId(remote)) {
    cache.set(uid, remote);
    saveLocalBuzzerSound(remote);
    return remote;
  }
  const choice = loadLocalBuzzerSound() ?? DEFAULT_BUZZER_SOUND;
  await set(ref(db, buzzerSoundPath(uid)), choice);
  cache.set(uid, choice);
  return choice;
}

/** Persists the user's choice globally (RTDB) + locally (localStorage). */
export async function setBuzzerSound(uid: UserId, id: BuzzerSoundId): Promise<void> {
  if (!isValidBuzzerSoundId(id)) throw new Error(`Invalid buzzer sound id: ${String(id)}`);
  saveLocalBuzzerSound(id);
  cache.set(uid, id);
  const db = getFirebaseDatabase();
  await set(ref(db, buzzerSoundPath(uid)), id);
}
