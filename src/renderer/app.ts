/** Renderer entry point: wires agent events, composer, and keyboard. */
import {
  addErrorMessage,
  addToolCall,
  addUserMessage,
  appendToken,
  clearFeed,
  finishStreaming,
  setEmptyStateText,
  setToolResult,
} from "./chat.js";
import { denyCurrent, isConfirmOpen, pushConfirmRequest, settleConfirm } from "./confirm.js";
import { initSettings, isSettingsOpen, openSettings, closeSettings } from "./settings.js";
import { setTtsEnabled, speak } from "./speech.js";
import { PROVIDER_DEFAULTS } from "../shared/provider-defaults.js";
import type { SettingsView } from "../shared/types.js";

const input = document.getElementById("input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const statusChip = document.getElementById("status-chip") as HTMLElement;
const newSessionBtn = document.getElementById("new-session") as HTMLButtonElement;
const openSettingsBtn = document.getElementById("open-settings") as HTMLButtonElement;

let running = false;
const pendingToolRows: HTMLElement[] = [];

function setRunning(on: boolean): void {
  running = on;
  sendBtn.textContent = on ? "Stop" : "Send";
  sendBtn.classList.toggle("danger-btn", on);
}

function applySettings(view: SettingsView): void {
  setTtsEnabled(view.tts);
  if (view.model) {
    statusChip.textContent = `${PROVIDER_DEFAULTS[view.provider].label} · ${view.model}`;
    statusChip.classList.add("online");
    setEmptyStateText("Standing by.");
  } else {
    statusChip.textContent = "not configured";
    statusChip.classList.remove("online");
    setEmptyStateText("No provider configured.");
  }
}

function send(): void {
  const text = input.value.trim();
  if (!text || running) return;
  input.value = "";
  addUserMessage(text);
  setRunning(true);
  window.jarvis.send(text);
}

sendBtn.addEventListener("click", () => {
  if (running) {
    window.jarvis.cancel();
  } else {
    send();
  }
});

newSessionBtn.addEventListener("click", () => {
  window.jarvis.resetChat();
  pendingToolRows.length = 0;
  clearFeed();
  setRunning(false);
});

openSettingsBtn.addEventListener("click", () => openSettings());

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    send();
    return;
  }
  if (e.key === "Escape") {
    if (isConfirmOpen()) {
      denyCurrent();
    } else if (isSettingsOpen()) {
      closeSettings();
    } else {
      window.jarvis.hideWindow();
    }
  }
});

window.jarvis.onAgentEvent((event) => {
  switch (event.type) {
    case "run-start":
      setRunning(true);
      break;
    case "token":
      appendToken(event.text);
      break;
    case "tool-call":
      pendingToolRows.push(addToolCall(event.name, event.summary));
      break;
    case "tool-result": {
      const row = pendingToolRows.shift();
      if (row) setToolResult(row, event.summary, event.isError);
      break;
    }
    case "confirm-request":
      pushConfirmRequest(event.request);
      break;
    case "confirm-settled":
      settleConfirm(event.id);
      break;
    case "done":
      finishStreaming();
      speak(event.text);
      setRunning(false);
      break;
    case "error":
      addErrorMessage(event.message);
      setRunning(false);
      break;
  }
});

void (async () => {
  const view = await window.jarvis.getSettings();
  initSettings(view, applySettings);
  applySettings(view);
  if (!view.model) {
    openSettings("No provider configured. Point Jarvis at your model to bring it online.");
  }
  input.focus();
})();
