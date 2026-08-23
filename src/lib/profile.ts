const STORAGE_KEY = "vb.displayName";
export const MAX_NAME_LENGTH = 24;

export type NameValidation =
  | { ok: true; name: string }
  | { ok: false; reason: "blank" | "too_long" };

/** Explicit validation so the UI can show precise errors instead of clamping silently. */
export function validateDisplayName(raw: string): NameValidation {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "blank" };
  if (trimmed.length > MAX_NAME_LENGTH) { return { ok: false, reason: "too_long" }; }
  return { ok: true, name: trimmed };
}

/** Returns the locally saved display name ('' if none / storage unavailable). */
export function loadSavedName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return ""; // private mode or blocked storage — just ask again
  }
}

/** Validates, persists and returns the cleaned display name. Throws on invalid input. */
export function saveDisplayName(rawName: string): string {
  const result = validateDisplayName(rawName);
  if (!result.ok) throw new Error(result.reason === "blank" ? "Display name is empty." : `Display name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  try {
    localStorage.setItem(STORAGE_KEY, result.name);
  } catch {
    // Non-fatal: the name still works this session.
  }
  return result.name;
}
