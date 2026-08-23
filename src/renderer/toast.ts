/** Transient toast notifications, top-right, self-dismissing. */

const HIDE_AFTER_MS = 3800;

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message: string, kind: "info" | "warn" = "info"): void {
  const host = ensureContainer();
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  window.setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    // Fallback removal in case transitions are disabled (reduced motion).
    window.setTimeout(() => toast.remove(), 600);
  }, HIDE_AFTER_MS);
}
