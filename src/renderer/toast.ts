/** Glass toasts — settings saved, connection test, session restored. */

const stack = document.getElementById("toast-stack") as HTMLElement;

export function showToast(message: string, kind: "info" | "ok" | "err" = "info"): void {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  stack.append(el);
  requestAnimationFrame(() => el.classList.add("visible"));
  window.setTimeout(() => {
    el.classList.remove("visible");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    window.setTimeout(() => el.remove(), 500);
  }, 4000);
}
