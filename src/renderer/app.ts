/** Renderer entry point: wires agent events, sessions, voice engines, orb. */
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
import { initOrb, setOrbLevel, setOrbMode, type OrbMode } from "./orb.js";
import {
  initRealtime,
  isRealtimeActive,
  sendRealtimeText,
  stopRealtime,
  toggleRealtime,
  type RealtimeState,
} from "./realtime.js";
import { applySession, initSessions, renderSessionList } from "./sessions.js";
import { closeSettings, initSettings, isSettingsOpen, openSettings } from "./settings.js";
import { isSpeaking, setTtsEnabled, speak, stopSpeaking } from "./speech.js";
import { showToast } from "./toast.js";
import {
  endPushToTalk,
  initVoice,
  setCapturePaused,
  startPushToTalk,
  stopListening,
  toggleListening,
  type VoiceUiState,
} from "./voice.js";
import { PROVIDER_DEFAULTS } from "../shared/provider-defaults.js";
import type { SettingsView } from "../shared/types.js";

const input = document.getElementById("input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const statusChip = document.getElementById("status-chip") as HTMLElement;
const newSessionBtn = document.getElementById("new-session") as HTMLButtonElement;
const openSettingsBtn = document.getElementById("open-settings") as HTMLButtonElement;
const micBtn = document.getElementById("mic") as HTMLButtonElement;
const orbCanvas = document.getElementById("orb") as HTMLCanvasElement;

let running = false;
let configured = false;
let canRetry = false;
let voiceUi: VoiceUiState = "off";
let rtState: RealtimeState = "off";
let settings: SettingsView | null = null;
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

function orbModeNow(): OrbMode {
  if (isConfirmOpen()) return "confirm";
  if (running) return "thinking";
  if (isSpeaking() || rtState === "speaking") return "speaking";
  if (rtState === "user-speech") return "speech";
  if (rtState === "connecting") return "starting";
  if (rtState === "live") return "listening";
  switch (voiceUi) {
    case "starting":
      return "starting";
    case "listening":
      return "listening";
    case "speech":
      return "speech";
    case "transcribing":
      return "thinking";
    default:
      return "off";
  }
}

function updateOrb(): void {
  const mode = orbModeNow();
  setOrbMode(mode);
  micBtn.dataset.state = mode;
}

function setRunning(on: boolean): void {
  running = on;
  sendBtn.textContent = on ? "Stop" : "Send";
  sendBtn.classList.toggle("danger-btn", on);
  if (!on && configured) setActivity("idle");
  updateOrb();
}

function realtimeAvailable(view: SettingsView): boolean {
  return view.provider === "openai" && view.hasApiKey && view.baseUrl.includes("api.openai.com");
}

function applySettings(view: SettingsView): void {
  settings = view;
  setTtsEnabled(view.tts);
  configured = Boolean(view.model);
  if (view.voiceEngine !== "realtime" && isRealtimeActive()) stopRealtime();
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

function submitToAgent(text: string): void {
  addUserMessage(text);
  canRetry = true;
  setRunning(true);
  setActivity("thinking");
  window.jarvis.send(text);
}

function send(): void {
  const text = input.value.trim();
  if (!text) return;
  if (isRealtimeActive()) {
    input.value = "";
    addUserMessage(text);
    sendRealtimeText(text);
    return;
  }
  if (running) return;
  input.value = "";
  submitToAgent(text);
}

function retryLast(): void {
  if (running || !canRetry) return;
  setRunning(true);
  setActivity("thinking");
  window.jarvis.retry();
}

async function startNewSession(): Promise<void> {
  if (hasVisibleMessages() && !window.confirm("Start a new session? The current chat is saved.")) {
    return;
  }
  stopSpeaking();
  if (isRealtimeActive()) stopRealtime();
  stopListening();
  const view = await window.jarvis.newSession();
  pendingToolRows.length = 0;
  await applySession(view);
  setRunning(false);
}

/** Toggle whichever voice engine is configured. */
async function toggleVoice(): Promise<void> {
  if (isSpeaking()) stopSpeaking();
  if (settings?.voiceEngine === "realtime") {
    if (!settings || !realtimeAvailable(settings)) {
      openSettings(
        "Realtime voice needs an OpenAI API key with the base URL set to api.openai.com."
      );
      return;
    }
    await toggleRealtime();
    return;
  }
  await toggleListening();
  updateOrb();
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

let holdTimer: number | null = null;
let holding = false;
let suppressClick = false;

micBtn.addEventListener("mousedown", () => {
  if (settings?.voiceEngine === "realtime") return;
  holdTimer = window.setTimeout(() => {
    holding = true;
    stopSpeaking();
    void startPushToTalk();
  }, 300);
});

window.addEventListener("mouseup", () => {
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer);
    holdTimer = null;
  }
  if (holding) {
    holding = false;
    suppressClick = true;
    endPushToTalk();
  }
});

micBtn.addEventListener("click", () => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  void toggleVoice();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    send();
    return;
  }
  if (e.key === "Escape") {
    if (isConfirmOpen()) {
      denyCurrent();
    } else if (isSpeaking() || running) {
      stopSpeaking();
      if (running) window.jarvis.cancel();
      setCapturePaused(false);
      updateOrb();
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
      setCapturePaused(true);
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
      updateOrb();
      break;
    case "confirm-settled":
      settleConfirm(event.id);
      updateOrb();
      break;
    case "done":
      finishStreaming();
      canRetry = false;
      setRunning(false);
      speak(event.text, () => {
        setCapturePaused(false);
        updateOrb();
      });
      updateOrb();
      break;
    case "error":
      addErrorMessage(event.message, canRetry ? retryLast : undefined);
      setActivity("error");
      setRunning(false);
      setCapturePaused(false);
      break;
    case "sessions-changed":
      renderSessionList(event.sessions, event.currentId);
      break;
  }
});

initVoice({
  onState: (state) => {
    voiceUi = state;
    updateOrb();
  },
  onLevel: (level) => setOrbLevel(level),
  onTranscript: (text) => {
    if (running) {
      showToast("Still working on the previous request.", "warn");
      return;
    }
    submitToAgent(text);
  },
  onNotice: (message) => showToast(message, "warn"),
  onHotkey: () => void toggleVoice(),
});

initRealtime({
  onState: (state) => {
    rtState = state;
    updateOrb();
  },
  onLevel: (level) => setOrbLevel(level),
  onUserTranscript: (text) => addUserMessage(text),
  onAssistantDelta: (text) => appendToken(text),
  onAssistantDone: () => finishStreaming(),
  onToolCall: (name, summary) => {
    pendingToolRows.push(addToolCall(name, summary));
  },
  onToolResult: (name, summary, isError) => {
    void name;
    const row = pendingToolRows.shift();
    if (row) setToolResult(row, summary, isError);
  },
  onNotice: (message) => showToast(message, "warn"),
});

initOrb(orbCanvas);
updateOrb();

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
