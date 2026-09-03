/** Minimal duck-typing for FirebaseError, avoiding an extra import surface. */
interface FirebaseLikeError {
  code?: string;
}

function errorCode(err: unknown): string {
  return (err as FirebaseLikeError)?.code ?? "";
}

/** Maps auth failures to actionable, user-readable messages. */
export function describeAuthError(err: unknown): string {
  switch (errorCode(err)) {
    case "auth/operation-not-allowed":
    case "auth/admin-restricted-operation":
      return (
        "Anonymous sign-in is disabled for this Firebase project. " +
        "Open the console → Authentication → Sign-in method → enable 'Anonymous', then reload."
      );
    case "auth/configuration-not-found":
      return (
        "Firebase Authentication is not set up for this project. " +
        "Open the console → Authentication → Get started, then reload."
      );
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid":
      return (
        "The Firebase API key is invalid. " +
        "Compare the VITE_FIREBASE_* values in your .env with the web app config in the console."
      );
    case "auth/network-request-failed":
      return "Cannot reach Firebase. Check your internet connection and try again.";
    case "auth/unauthorized-domain":
      return (
        `This domain (${location.hostname}) is not authorized for sign-in. ` +
        "Add it under Authentication → Settings → Authorized domains."
      );
    default: {
      const code = errorCode(err);
      return (
        `Sign-in failed${code ? ` (${code})` : ""}. ` +
        "Verify your .env configuration and that Anonymous Authentication is enabled."
      );
    }
  }
}

/** Maps Realtime Database failures to actionable, user-readable messages. */
export function describeDbError(err: unknown): string {
  const code = errorCode(err);
  switch (code) {
    case "permission-denied":
    case "PERMISSION_DENIED":
    case "permission_denied":
      return (
        "Realtime Database denied the operation. " +
        "Make sure the database exists and that rules matching docs/data-model.md are deployed."
      );
    default: {
      // Firebase RTDB errors always carry a STRING code (e.g. "unavailable").
      // A NUMERIC code means the exception is not from Firebase at all
      // (DOM codes: 8 = NotFoundError, 18 = SecurityError, 19 = NetworkError…).
      if (typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "number") {
        return `Unexpected client error (DOM code ${(err as { code: number }).code}). Check the console for details.`;
      }
      return `Database error${code ? ` (${code})` : ""}. Check your connection and Firebase setup.`;
    }
  }
}
