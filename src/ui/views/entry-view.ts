import { MAX_NAME_LENGTH, validateDisplayName } from "../../lib/profile";
import { parseRoomCode } from "../../lib/rooms";
import { extractVideoId } from "../../lib/youtube";
import type { EntryViewCallbacks } from "../types";

/** Allows typing beyond the limit so the "too long" validation can be shown. */
const INPUT_NAME_LIMIT = MAX_NAME_LENGTH * 2;

function makeField(labelText: string, input: HTMLInputElement): {
  field: HTMLElement;
  error: HTMLElement;
} {
  const label = document.createElement("label");
  label.className = "vb-label";
  label.textContent = labelText;
  label.htmlFor = input.id;

  const error = document.createElement("div");
  error.className = "vb-field-error";

  const field = document.createElement("div");
  field.className = "vb-field";
  field.append(label, input, error);
  return { field, error };
}

function makeNameInput(id: string, savedValue: string): HTMLInputElement {
  const input = document.createElement("input");
  input.id = id;
  input.className = "vb-input";
  input.type = "text";
  input.maxLength = INPUT_NAME_LIMIT;
  input.placeholder = "e.g. Alex";
  input.value = savedValue;
  return input;
}

export function renderEntryView(opts: {
  savedName: string;
  initialCode?: string;
  callbacks: EntryViewCallbacks;
}): { root: HTMLElement; showError(message: string): void } {
  const root = document.createElement("main");
  root.className = "vb-entry";

  const title = document.createElement("h1");
  title.className = "vb-title";
  title.textContent = "Video Buzzer";

  const subtitle = document.createElement("p");
  subtitle.className = "vb-subtitle";
  subtitle.textContent = "Watch a YouTube video together — buzz first, answer out loud.";

  /* ---------- Create game ---------- */

  const ytInput = document.createElement("input");
  ytInput.id = "vb-yt";
  ytInput.className = "vb-input";
  ytInput.type = "text";
  ytInput.spellcheck = false;
  ytInput.placeholder = "https://www.youtube.com/watch?v=… (optional)";

  const hostNameInput = makeNameInput("vb-host-name", opts.savedName);

  const ytField = makeField("YouTube URL — optional, pick later in the room", ytInput);
  const hostNameField = makeField("Your name", hostNameInput);

  const createBtn = document.createElement("button");
  createBtn.className = "vb-btn vb-btn--primary vb-btn--flush";
  createBtn.textContent = "Create game";

  createBtn.addEventListener("click", () => {
    const nameCheck = validateDisplayName(hostNameInput.value);
    if (!nameCheck.ok) {
      hostNameField.error.textContent =
        nameCheck.reason === "blank" ? "Enter your name." : `Keep it to ${MAX_NAME_LENGTH} characters.`;
      hostNameInput.focus();
      return;
    }
    hostNameField.error.textContent = "";

    // URL is now OPTIONAL: empty creates a room with no active video; a
    // non-empty value must still be a valid YouTube link.
    const rawUrl = ytInput.value.trim();
    if (rawUrl && !extractVideoId(rawUrl)) {
      ytField.error.textContent = "Enter a valid YouTube URL (or leave it empty).";
      ytInput.focus();
      return;
    }
    ytField.error.textContent = "";

    opts.callbacks.onCreateRoom(rawUrl, nameCheck.name);
  });

  ytInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") hostNameInput.focus();
  });
  hostNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") createBtn.click();
  });

  const createCard = document.createElement("section");
  createCard.className = "vb-card";
  const createTitle = document.createElement("h2");
  createTitle.className = "vb-card-title";
  createTitle.textContent = "Create game";
  createCard.append(createTitle, ytField.field, hostNameField.field, createBtn);

  /* ---------- Join game ---------- */

  const codeInput = document.createElement("input");
  codeInput.id = "vb-code";
  codeInput.className = "vb-input";
  codeInput.type = "text";
  codeInput.spellcheck = false;
  codeInput.placeholder = "ABC123 or share link…";
  codeInput.value = opts.initialCode ?? "";

  const playerNameInput = makeNameInput("vb-player-name", "");

  const codeField = makeField("Room code or link", codeInput);
  const playerNameField = makeField("Your name", playerNameInput);

  const joinBtn = document.createElement("button");
  joinBtn.className = "vb-btn vb-btn--ghost vb-btn--flush";
  joinBtn.textContent = "Join game";

  joinBtn.addEventListener("click", () => {
    const nameCheck = validateDisplayName(playerNameInput.value);
    if (!nameCheck.ok) {
      playerNameField.error.textContent =
        nameCheck.reason === "blank" ? "Enter your name." : `Keep it to ${MAX_NAME_LENGTH} characters.`;
      playerNameInput.focus();
      return;
    }
    playerNameField.error.textContent = "";

    const code = parseRoomCode(codeInput.value);
    if (!code) {
      codeField.error.textContent = "Enter a valid room code or share link.";
      codeInput.focus();
      return;
    }
    codeField.error.textContent = "";

    opts.callbacks.onJoinRoom(code, nameCheck.name);
  });

  codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") playerNameInput.focus();
  });
  playerNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinBtn.click();
  });

  const joinCard = document.createElement("section");
  joinCard.className = "vb-card";
  const joinTitle = document.createElement("h2");
  joinTitle.className = "vb-card-title";
  joinTitle.textContent = "Join game";
  joinCard.append(joinTitle, codeField.field, playerNameField.field, joinBtn);

  /* ---------- Shell ---------- */

  const formError = document.createElement("div");
  formError.className = "vb-form-error";
  formError.setAttribute("role", "alert");

  root.append(title, subtitle, createCard, joinCard, formError);
  (opts.initialCode ? playerNameInput : ytInput).focus();

  return {
    root,
    showError(message: string) {
      formError.textContent = message;
      formError.hidden = message === "";
    },
  };
}
