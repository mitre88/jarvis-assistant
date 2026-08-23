/** Approval modal for sensitive tool actions (file writes, shell commands). */
import type { ConfirmRequest } from "../shared/types.js";

const overlay = document.getElementById("confirm-overlay") as HTMLElement;
const titleEl = document.getElementById("confirm-title") as HTMLElement;
const detailEl = document.getElementById("confirm-detail") as HTMLElement;
const queueEl = document.getElementById("confirm-queue") as HTMLElement;
const approveBtn = document.getElementById("confirm-approve") as HTMLButtonElement;
const denyBtn = document.getElementById("confirm-deny") as HTMLButtonElement;

const queue: ConfirmRequest[] = [];
let current: ConfirmRequest | null = null;

function updateQueueBadge(): void {
  const n = queue.length;
  if (n === 0) {
    queueEl.hidden = true;
    queueEl.textContent = "";
    return;
  }
  queueEl.hidden = false;
  queueEl.textContent = `${n} more pending`;
}

function showNext(): void {
  current = queue.shift() ?? null;
  updateQueueBadge();
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
  else updateQueueBadge();
}

/** Main resolved/expired this request (e.g. run cancelled): drop it. */
export function settleConfirm(id: string): void {
  const queued = queue.findIndex((r) => r.id === id);
  if (queued >= 0) {
    queue.splice(queued, 1);
    updateQueueBadge();
    return;
  }
  if (current?.id === id) {
    current = null;
    showNext();
  }
}

approveBtn.addEventListener("click", () => respond(true));
denyBtn.addEventListener("click", () => respond(false));

overlay.addEventListener("keydown", (e) => {
  if (!current) return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    respond(true);
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    if (document.activeElement === approveBtn) denyBtn.focus();
    else approveBtn.focus();
  }
});
