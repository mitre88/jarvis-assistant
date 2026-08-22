/** Conversation feed: user/assistant bubbles, streaming, tool activity rows. */
import { renderMarkdown } from "./markdown.js";
import type { ChatBubble } from "../shared/types.js";

const feed = document.getElementById("feed") as HTMLElement;
const emptyState = document.getElementById("empty-state") as HTMLElement;
const emptyTitle = document.getElementById("empty-title") as HTMLElement;
const emptySettings = document.getElementById("empty-settings") as HTMLButtonElement;

let streamingEl: HTMLElement | null = null;
let streamingText = "";
let stickToBottom = true;

feed.addEventListener("scroll", () => {
  stickToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 64;
});

function scrollToBottom(): void {
  if (stickToBottom) feed.scrollTop = feed.scrollHeight;
}

function hideEmptyState(): void {
  emptyState.style.display = "none";
}

export function setEmptyStateText(text: string, showSettingsCta = false): void {
  emptyTitle.textContent = text;
  emptySettings.hidden = !showSettingsCta;
}

export function onEmptySettingsClick(handler: () => void): void {
  emptySettings.addEventListener("click", handler);
}

export function hasVisibleMessages(): boolean {
  return [...feed.children].some((c) => c !== emptyState);
}

export function addUserMessage(text: string): void {
  hideEmptyState();
  const el = document.createElement("div");
  el.className = "msg user";
  el.textContent = text;
  feed.appendChild(el);
  stickToBottom = true;
  scrollToBottom();
}

export function addAssistantMessage(text: string): void {
  hideEmptyState();
  const el = document.createElement("div");
  el.className = "msg assistant";
  el.innerHTML = renderMarkdown(text);
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
  streamingEl.textContent = streamingText;
  scrollToBottom();
}

/** Close the current streaming bubble (final answer or before a tool round). */
export function finishStreaming(): void {
  if (streamingEl) {
    streamingEl.classList.remove("streaming");
    streamingEl.innerHTML = renderMarkdown(streamingText);
    streamingEl = null;
    streamingText = "";
  }
}

export function addToolCall(name: string, summary: string): HTMLElement {
  hideEmptyState();
  finishStreaming();
  const row = document.createElement("div");
  row.className = "tool-row pending";
  const head = document.createElement("div");
  head.className = "tool-head";
  const spin = document.createElement("span");
  spin.className = "tool-spin";
  spin.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = `${name} ${summary}`;
  head.append(spin, label);
  const result = document.createElement("div");
  result.className = "tool-result";
  result.textContent = "…";
  row.append(head, result);
  feed.appendChild(row);
  scrollToBottom();
  return row;
}

export function setToolResult(row: HTMLElement, summary: string, isError: boolean): void {
  row.classList.remove("pending");
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
  stickToBottom = true;
  for (const child of [...feed.children]) {
    if (child !== emptyState) child.remove();
  }
  emptyState.style.display = "";
}

export function hydrateFeed(bubbles: ChatBubble[]): void {
  clearFeed();
  if (bubbles.length === 0) return;
  hideEmptyState();
  for (const b of bubbles) {
    if (b.kind === "user") addUserMessage(b.content);
    else if (b.kind === "assistant") addAssistantMessage(b.content);
    else {
      const row = addToolCall(b.name ?? "tool", "");
      setToolResult(row, b.content.replace(/\s+/g, " ").trim().slice(0, 160), false);
    }
  }
  stickToBottom = true;
  scrollToBottom();
}
