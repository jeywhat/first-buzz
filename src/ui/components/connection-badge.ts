/** Small pill showing the local client's Realtime Database connection state. */
export function renderConnectionBadge(): {
  root: HTMLElement;
  setOnline(online: boolean): void;
} {
  const root = document.createElement("span");
  root.className = "vb-badge vb-badge--offline";

  const dot = document.createElement("span");
  dot.className = "vb-badge__dot";

  const label = document.createElement("span");
  label.className = "vb-badge__label";
  label.textContent = "Offline";

  root.append(dot, label);

  return {
    root,
    setOnline(online: boolean) {
      root.classList.toggle("vb-badge--online", online);
      root.classList.toggle("vb-badge--offline", !online);
      label.textContent = online ? "Connected" : "Offline";
    },
  };
}
