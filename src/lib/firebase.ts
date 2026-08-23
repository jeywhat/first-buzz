import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  type Auth,
} from "firebase/auth";
import { connectDatabaseEmulator, getDatabase, type Database } from "firebase/database";

/**
 * Reads the public Firebase web config from Vite environment variables.
 * Throws early with a clear message if any variable is missing.
 */
function readFirebaseConfig() {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase configuration: ${missing.join(", ")}. ` +
        "Copy .env.example to .env and fill in the values.",
    );
  }

  return config;
}

/**
 * Points Auth + RTDB at the local Emulator Suite when explicitly enabled via
 * VITE_USE_FIREBASE_EMULATORS="true". The flag must stay unset in production.
 */
function attachEmulators(app: FirebaseApp): void {
  if (import.meta.env.VITE_USE_FIREBASE_EMULATORS !== "true") return;
  connectDatabaseEmulator(getDatabase(app), "localhost", 9000);
  connectAuthEmulator(getAuth(app), "http://localhost:9099", { disableWarnings: true });
}

let appInstance: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Database | undefined;

/** Initializes Firebase exactly once and returns the app. */
function getApp(): FirebaseApp {
  appInstance ??= (() => {
    const app = initializeApp(readFirebaseConfig());
    attachEmulators(app);
    return app;
  })();
  return appInstance;
}

/** Returns the Auth instance. */
export function getFirebaseAuth(): Auth {
  authInstance ??= getAuth(getApp());
  return authInstance;
}

/** Returns the Realtime Database instance. */
export function getFirebaseDatabase(): Database {
  dbInstance ??= getDatabase(getApp());
  return dbInstance;
}

/**
 * Signs in anonymously. Reuses the existing anonymous identity when present
 * so a page reload keeps the same uid (and thus host rights).
 */
export async function ensureAnonymousSignIn(): Promise<string> {
  const auth = getFirebaseAuth();
  if (auth.currentUser) return auth.currentUser.uid;
  const credential = await signInAnonymously(auth);
  return credential.user.uid;
}
