// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createYoutubePlayer } from "./youtube-player";

/**
 * Regression guard: createYoutubePlayer must complete its SYNCHRONOUS setup
 * without throwing. A previous regression called renderVolume() before the
 * player-lifecycle declarations (`ready`/`player`), hitting the temporal
 * dead zone — which crashed enterRoom() and surfaced as the generic
 * "Database error…" message on room creation.
 */
describe("createYoutubePlayer setup", () => {
  it("completes synchronous setup without throwing (volume TDZ regression)", () => {
    expect(() => {
      const handles = createYoutubePlayer("dQw4w9WgXcQ", {
        isHost: true,
        onHostAction: () => {},
      });
      handles.dispose();
    }).not.toThrow();
  });

  it("mounts the volume control inline for the host", () => {
    const handles = createYoutubePlayer("dQw4w9WgXcQ", {
      isHost: true,
      onHostAction: () => {},
    });
    const vol = handles.root.querySelector(".vb-volume");
    expect(vol).not.toBeNull();
    expect(vol?.classList.contains("vb-volume--floating")).toBe(false);
    expect(vol?.querySelector(".vb-volume__level")?.textContent).toBe("100%");
    handles.dispose();
  });

  it("mounts the floating volume control for players", () => {
    const handles = createYoutubePlayer("dQw4w9WgXcQ", {
      isHost: false,
      onHostAction: () => {},
    });
    const vol = handles.root.querySelector(".vb-volume");
    expect(vol).not.toBeNull();
    expect(vol?.classList.contains("vb-volume--floating")).toBe(true);
    handles.dispose();
  });
});
