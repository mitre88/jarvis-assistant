/** Renderer entry point: wires agent events, voice engines, orb, composer. */
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
import { initOrb, setOrbLevel, setOrbMode, type OrbMode } from "./orb.js";
import {
  initRealtime,
  isRealtimeActive,
  sendRealtimeText,
  stopRealtime,
  toggleRealtime,
  type RealtimeState,
} from "./realtime.js";
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
let voiceUi: VoiceUiState = "off";
let rtState: RealtimeState = "off";
let settings: SettingsView | null = null;
const pendingToolRows: HTMLElement[] = [];

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
  updateOrb();
}

function realtimeAvailable(view: SettingsView): boolean {
  return view.provider === "openai" && view.hasApiKey && view.baseUrl.includes("api.openai.com");
}

function applySettings(view: SettingsView): void {
  settings = view;
  setTtsEnabled(view.tts);
  if (view.voiceEngine !== "realtime" && isRealtimeActive()) stopRealtime();
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

function submitToAgent(text: string): void {
  addUserMessage(text);
  setRunning(true);
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

/* ---------- composer & buttons ---------- */

sendBtn.addEventListener("click", () => {
  if (running) {
    window.jarvis.cancel();
  } else {
    send();
  }
});

newSessionBtn.addEventListener("click", () => {
  stopSpeaking();
  if (isRealtimeActive()) stopRealtime();
  stopListening();
  window.jarvis.resetChat();
  pendingToolRows.length = 0;
  clearFeed();
  setRunning(false);
});

openSettingsBtn.addEventListener("click", () => openSettings());

/* Mic button: click toggles listening; press-and-hold is push-to-talk. */
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

/* ---------- agent events ---------- */

window.jarvis.onAgentEvent((event) => {
  switch (event.type) {
    case "run-start":
      setRunning(true);
      setCapturePaused(true);
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
      updateOrb();
      break;
    case "confirm-settled":
      settleConfirm(event.id);
      updateOrb();
      break;
    case "done":
      finishStreaming();
      setRunning(false);
      speak(event.text, () => {
        setCapturePaused(false);
        updateOrb();
      });
      updateOrb();
      break;
    case "error":
      addErrorMessage(event.message);
      setRunning(false);
      setCapturePaused(false);
      break;
  }
});

/* ---------- voice engines ---------- */

initVoice({
  onState: (state) => {
    voiceUi = state;
    updateOrb();
  },
  onLevel: (level) => setOrbLevel(level),
  onTranscript: (text) => {
    if (running) {
      showToast("Still working on the previous request.");
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

/* ---------- boot ---------- */

initOrb(orbCanvas);
updateOrb();

void (async () => {
  const view = await window.jarvis.getSettings();
  initSettings(view, applySettings);
  applySettings(view);
  if (!view.model) {
    openSettings("No provider configured. Point Jarvis at your model to bring it online.");
  }
  input.focus();
})();
