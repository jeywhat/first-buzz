export type ToastKind = "success" | "error";

export interface ToastHost {
  show(message: string, kind?: ToastKind): void;
}

/**
 * Unobtrusive bottom-center toast stack (aria-live polite). One instance per
 * page; messages auto-dismiss and never steal focus.
 */
export function createToastHost(): ToastHost {
  const root = document.createElement("div");
  root.className = "vb-toasts";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  document.body.append(root);

  function show(message: string, kind: ToastKind = "success"): void {
    const toast = document.createElement("div");
    toast.className = `vb-toast vb-toast--${kind}`;
    toast.textContent = message; // app-provided strings only
    root.append(toast);

    window.setTimeout(() => {
      toast.classList.add("vb-toast--leave");
      window.setTimeout(() => toast.remove(), 200);
    }, 2400);

    // Cap the stack so rapid actions cannot flood the screen.
    while (root.children.length > 3) root.firstChild?.remove();
  }

  return { show };
}
