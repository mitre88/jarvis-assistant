/** Renderer entry point: wires agent events, composer, and keyboard. */
import {
  addErrorMessage,
  addToolCall,
  addUserMessage,
  appendToken,
  finishStreaming,
  hasVisibleMessages,
  onEmptySettingsClick,
  setEmptyStateText,
  setToolResult,
} from "./chat.js";
import { denyCurrent, isConfirmOpen, pushConfirmRequest, settleConfirm } from "./confirm.js";
import { applySession, initSessions, renderSessionList } from "./sessions.js";
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
let configured = false;
const pendingToolRows: HTMLElement[] = [];

type Activity = "offline" | "idle" | "thinking" | "streaming" | "error";

function setActivity(state: Activity): void {
  statusChip.dataset.state = state;
  const model = statusChip.dataset.model ?? "";
  if (!configured) {
    statusChip.textContent = "not configured";
    return;
  }
  statusChip.textContent = model ? `${state} · ${model}` : state;
}

function setRunning(on: boolean): void {
  running = on;
  sendBtn.textContent = on ? "Stop" : "Send";
  sendBtn.classList.toggle("danger-btn", on);
  if (!on && configured) setActivity("idle");
}

function applySettings(view: SettingsView): void {
  setTtsEnabled(view.tts);
  configured = Boolean(view.model);
  if (view.model) {
    statusChip.dataset.model = `${PROVIDER_DEFAULTS[view.provider].label} · ${view.model}`;
    setEmptyStateText("Standing by.", false);
    setActivity(running ? "thinking" : "idle");
  } else {
    statusChip.dataset.model = "";
    setEmptyStateText("No provider configured.", true);
    setActivity("offline");
  }
}

function send(): void {
  const text = input.value.trim();
  if (!text || running) return;
  input.value = "";
  addUserMessage(text);
  setRunning(true);
  setActivity("thinking");
  window.jarvis.send(text);
}

async function startNewSession(): Promise<void> {
  if (hasVisibleMessages() && !window.confirm("Start a new session? The current chat is saved.")) {
    return;
  }
  const view = await window.jarvis.newSession();
  pendingToolRows.length = 0;
  await applySession(view);
  setRunning(false);
}

sendBtn.addEventListener("click", () => {
  if (running) {
    window.jarvis.cancel();
  } else {
    send();
  }
});

newSessionBtn.addEventListener("click", () => {
  void startNewSession();
});

openSettingsBtn.addEventListener("click", () => openSettings());
onEmptySettingsClick(() => openSettings());

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
      setActivity("thinking");
      break;
    case "token":
      setActivity("streaming");
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
      setActivity("error");
      setRunning(false);
      break;
    case "sessions-changed":
      renderSessionList(event.sessions, event.currentId);
      break;
  }
});

void (async () => {
  document.body.dataset.platform = window.jarvis.platform;
  initSessions();
  const view = await window.jarvis.getSettings();
  initSettings(view, applySettings);
  applySettings(view);
  const session = await window.jarvis.getCurrentSession();
  const sessions = await window.jarvis.listSessions();
  await applySession(session, sessions);
  if (!view.model) {
    openSettings("No provider configured. Point Jarvis at your model to bring it online.");
  }
  input.focus();
})();
