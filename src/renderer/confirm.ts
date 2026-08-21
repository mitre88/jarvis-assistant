/** Approval modal for sensitive tool actions (file writes, shell commands). */
import type { ConfirmRequest } from "../shared/types.js";

const overlay = document.getElementById("confirm-overlay") as HTMLElement;
const titleEl = document.getElementById("confirm-title") as HTMLElement;
const detailEl = document.getElementById("confirm-detail") as HTMLElement;
const approveBtn = document.getElementById("confirm-approve") as HTMLButtonElement;
const denyBtn = document.getElementById("confirm-deny") as HTMLButtonElement;

const queue: ConfirmRequest[] = [];
let current: ConfirmRequest | null = null;

function showNext(): void {
  current = queue.shift() ?? null;
  if (!current) {
    overlay.classList.remove("open");
    overlay.hidden = true;
    return;
  }
  titleEl.textContent = current.title;
  detailEl.textContent = current.detail;
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add("open"));
  approveBtn.focus();
}

function respond(approved: boolean): void {
  if (!current) return;
  window.jarvis.respondConfirm(current.id, approved);
  showNext();
}

export function isConfirmOpen(): boolean {
  return current !== null;
}

export function denyCurrent(): void {
  respond(false);
}

export function pushConfirmRequest(request: ConfirmRequest): void {
  queue.push(request);
  if (!current) showNext();
}

/** Main resolved/expired this request (e.g. run cancelled): drop it. */
export function settleConfirm(id: string): void {
  const queued = queue.findIndex((r) => r.id === id);
  if (queued >= 0) {
    queue.splice(queued, 1);
    return;
  }
  if (current?.id === id) {
    current = null;
    showNext();
  }
}

approveBtn.addEventListener("click", () => respond(true));
denyBtn.addEventListener("click", () => respond(false));
