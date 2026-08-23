/** Glass toasts — settings saved, connection test, voice notices. */

const stack = document.getElementById("toast-stack") as HTMLElement;

export function showToast(
  message: string,
  kind: "info" | "ok" | "err" | "warn" = "info"
): void {
  const mapped = kind === "warn" ? "err" : kind;
  const el = document.createElement("div");
  el.className = `toast toast-${mapped}`;
  el.textContent = message;
  stack.append(el);
  requestAnimationFrame(() => el.classList.add("visible"));
  window.setTimeout(() => {
    el.classList.remove("visible");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    window.setTimeout(() => el.remove(), 500);
  }, 4000);
}
