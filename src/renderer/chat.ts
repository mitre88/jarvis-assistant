/** Conversation feed: user/assistant bubbles, streaming, tool activity rows. */
import { renderMarkdown } from "./markdown.js";

const feed = document.getElementById("feed") as HTMLElement;
const emptyState = document.getElementById("empty-state") as HTMLElement;

let streamingEl: HTMLElement | null = null;
let streamingText = "";

function scrollToBottom(): void {
  feed.scrollTop = feed.scrollHeight;
}

function hideEmptyState(): void {
  emptyState.style.display = "none";
}

export function setEmptyStateText(text: string): void {
  emptyState.textContent = text;
}

export function addUserMessage(text: string): void {
  hideEmptyState();
  const el = document.createElement("div");
  el.className = "msg user";
  el.textContent = text;
  feed.appendChild(el);
  scrollToBottom();
}

export function appendToken(text: string): void {
  hideEmptyState();
  if (!streamingEl) {
    streamingEl = document.createElement("div");
    streamingEl.className = "msg assistant streaming";
    streamingText = "";
    feed.appendChild(streamingEl);
  }
  streamingText += text;
  streamingEl.innerHTML = renderMarkdown(streamingText);
  scrollToBottom();
}

/** Close the current streaming bubble (final answer or before a tool round). */
export function finishStreaming(): void {
  if (streamingEl) {
    streamingEl.classList.remove("streaming");
    streamingEl = null;
    streamingText = "";
  }
}

export function addToolCall(name: string, summary: string): HTMLElement {
  hideEmptyState();
  finishStreaming();
  const row = document.createElement("div");
  row.className = "tool-row";
  const head = document.createElement("div");
  head.textContent = `⟐ ${name} ${summary}`;
  const result = document.createElement("div");
  result.className = "tool-result";
  result.textContent = "…";
  row.append(head, result);
  feed.appendChild(row);
  scrollToBottom();
  return row;
}

export function setToolResult(row: HTMLElement, summary: string, isError: boolean): void {
  const result = row.querySelector(".tool-result") as HTMLElement;
  result.textContent = summary || "(done)";
  result.classList.toggle("error", isError);
  scrollToBottom();
}

export function addErrorMessage(message: string): void {
  hideEmptyState();
  finishStreaming();
  const el = document.createElement("div");
  el.className = "msg error";
  el.textContent = message;
  feed.appendChild(el);
  scrollToBottom();
}

export function clearFeed(): void {
  streamingEl = null;
  streamingText = "";
  for (const child of [...feed.children]) {
    if (child !== emptyState) child.remove();
  }
  emptyState.style.display = "";
}
