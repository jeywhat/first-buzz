import { browserLocalPersistence, setPersistence } from "firebase/auth";
import type { UserId } from "../types";
import { describeAuthError } from "./errors";
import { ensureAnonymousSignIn, getFirebaseAuth } from "./firebase";

/**
 * Signs the user in anonymously on load. Firebase's local persistence keeps
 * the same anonymous identity across refreshes whenever the browser allows it
 * (cleared only if storage is wiped or blocked).
 */
export async function initAuth(): Promise<UserId> {
  const auth = getFirebaseAuth();
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    // Storage unavailable (e.g. private mode) — Firebase falls back to session-only.
  }
  try {
    return await ensureAnonymousSignIn();
  } catch (err) {
    throw new Error(describeAuthError(err), { cause: err });
  }
}
