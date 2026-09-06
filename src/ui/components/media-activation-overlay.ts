import type { LocalMediaCompatibilityState } from "../../services/localMediaCompatibilityService";

export interface MediaActivationOverlayHandles {
  root: HTMLElement;
  /** Shows the blocking overlay for restricted clients until activation. */
  render(state: LocalMediaCompatibilityState): void;
  dispose(): void;
}

/**
 * iOS/mobile activation screen ("Activer l'expérience").
 *
 * - A BLOCKING modal overlay shown ONLY for `restricted-media` clients while
 *   `localActivated` is still false. It hides (display:none — removed from
 *   hit-testing) as soon as the activation gesture is recorded; it is never
 *   rendered for `desktop-compatible` clients.
 * - The button handler runs the local media APIs synchronously (player
 *   priming play→pause, Web Audio resume) via the local compatibility
 *   service — it NEVER writes to Firebase.
 * - Firebase events arriving BEFORE the tap are safe: the existing player
 *   path simply attempts and gets blocked locally (no JS errors); the tap
   * then primes and re-syncs to the latest authoritative snapshot.
 */
export function createMediaActivationOverlay(
  onActivate: () => Promise<unknown> | void,
): MediaActivationOverlayHandles {
  const root = document.createElement("section");
  root.className = "vb-media-activation";
  root.hidden = true;

  const card = document.createElement("div");
  card.className = "vb-media-activation__card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Activate the experience");

  const icon = document.createElement("span");
  icon.className = "vb-media-activation__icon";
  icon.textContent = "▶";
  icon.setAttribute("aria-hidden", "true");

  const title = document.createElement("h2");
  title.className = "vb-media-activation__title";
  title.textContent = "Prêt à jouer ?";

  const text = document.createElement("p");
  text.className = "vb-media-activation__text";
  text.textContent =
    "Ton navigateur bloque la lecture automatique. Un seul tap synchronise la vidéo et le son sur cet appareil — cela ne change rien pour les autres joueurs.";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "vb-btn vb-btn--primary vb-media-activation__btn";
  button.textContent = "⚡ Activer l'expérience";
  button.setAttribute("aria-label", "Activer l'expérience — démarrer la vidéo et le son");

  button.addEventListener("click", () => {
    // Trusted gesture: local media APIs run immediately from this handler.
    void onActivate();
  });

  card.append(icon, title, text, button);
  root.append(card);

  return {
    root,
    render(state) {
      // ONLY restricted-media clients, and only until the activation tap.
      // Desktop-compatible clients can never see it (dev-asserted).
      const visible = state.mode === "restricted-media" && !state.localActivated;
      root.hidden = !visible;
      if (visible && !card.contains(document.activeElement)) {
        // Give the activation button keyboard focus while blocking the view.
        button.focus({ preventScroll: true });
      }
    },
    dispose() {
      root.remove();
    },
  };
}
