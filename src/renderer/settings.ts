/** Settings panel: provider config, connection test, voice options, persistence. */
import { PROVIDER_DEFAULTS } from "../shared/provider-defaults.js";
import type {
  ProviderKind,
  SettingsUpdate,
  SettingsView,
  VoiceEngine,
  WhisperModelView,
} from "../shared/types.js";

const panel = document.getElementById("settings-panel") as HTMLElement;
const notice = document.getElementById("settings-notice") as HTMLElement;
const providerEl = document.getElementById("s-provider") as HTMLSelectElement;
const baseUrlEl = document.getElementById("s-baseurl") as HTMLInputElement;
const apiKeyEl = document.getElementById("s-apikey") as HTMLInputElement;
const apiKeyHint = document.getElementById("s-apikey-hint") as HTMLElement;
const modelEl = document.getElementById("s-model") as HTMLInputElement;
const orgEl = document.getElementById("s-org") as HTMLInputElement;
const headersEl = document.getElementById("s-headers") as HTMLTextAreaElement;
const ttsEl = document.getElementById("s-tts") as HTMLInputElement;
const testBtn = document.getElementById("s-test") as HTMLButtonElement;
const saveBtn = document.getElementById("s-save") as HTMLButtonElement;
const closeBtn = document.getElementById("s-close") as HTMLButtonElement;
const testResult = document.getElementById("s-test-result") as HTMLElement;

const voiceEngineEl = document.getElementById("s-voice-engine") as HTMLSelectElement;
const whisperFields = document.getElementById("s-whisper-fields") as HTMLElement;
const realtimeFields = document.getElementById("s-realtime-fields") as HTMLElement;
const whisperModelEl = document.getElementById("s-whisper-model") as HTMLSelectElement;
const modelStatusEl = document.getElementById("s-model-status") as HTMLElement;
const modelDownloadBtn = document.getElementById("s-model-download") as HTMLButtonElement;
const modelDeleteBtn = document.getElementById("s-model-delete") as HTMLButtonElement;
const modelBrowseBtn = document.getElementById("s-model-browse") as HTMLButtonElement;
const sttLangEl = document.getElementById("s-stt-lang") as HTMLSelectElement;
const realtimeVoiceEl = document.getElementById("s-realtime-voice") as HTMLSelectElement;

let hasStoredKey = false;
let clearKey = false;
let onSaved: (view: SettingsView) => void = () => {};

let whisperCatalog: WhisperModelView[] = [];
let customModelPath = "";
let downloading = false;

function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (name && value) headers[name] = value;
  }
  return headers;
}

function serializeHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function updateKeyHint(): void {
  apiKeyHint.innerHTML = "";
  if (clearKey) {
    apiKeyHint.textContent = "Stored key will be removed on save.";
    apiKeyHint.style.color = "var(--amber)";
    return;
  }
  apiKeyHint.style.color = "";
  if (hasStoredKey) {
    apiKeyHint.append("A key is stored in the OS keychain. Leave blank to keep it. ");
    const clear = document.createElement("a");
    clear.href = "#";
    clear.textContent = "Remove key";
    clear.addEventListener("click", (e) => {
      e.preventDefault();
      clearKey = true;
      apiKeyEl.value = "";
      updateKeyHint();
    });
    apiKeyHint.append(clear);
  } else {
    const kind = providerEl.value as ProviderKind;
    apiKeyHint.textContent = PROVIDER_DEFAULTS[kind].needsKey
      ? "No key stored yet."
      : "Local providers usually need no key.";
  }
}

/* ---------- voice section ---------- */

function updateEngineVisibility(): void {
  const engine = voiceEngineEl.value as VoiceEngine;
  whisperFields.hidden = engine !== "whisper";
  realtimeFields.hidden = engine !== "realtime";
}

async function refreshWhisperCatalog(selected: string): Promise<void> {
  whisperCatalog = await window.jarvis.listWhisperModels();
  whisperModelEl.innerHTML = "";
  for (const m of whisperCatalog) {
    const option = document.createElement("option");
    option.value = m.id;
    option.textContent = `${m.label} · ${m.sizeMB} MB${m.downloaded ? " ✓" : ""}`;
    whisperModelEl.appendChild(option);
  }
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom model file…";
  whisperModelEl.appendChild(custom);
  whisperModelEl.value = selected;
  if (whisperModelEl.value !== selected) whisperModelEl.value = "base.en";
  updateModelStatus();
}

function updateModelStatus(): void {
  if (downloading) return;
  const id = whisperModelEl.value;
  modelDownloadBtn.hidden = true;
  modelDeleteBtn.hidden = true;
  modelBrowseBtn.hidden = true;

  if (id === "custom") {
    modelBrowseBtn.hidden = false;
    modelStatusEl.textContent = customModelPath
      ? customModelPath
      : "No file selected yet.";
    return;
  }
  const entry = whisperCatalog.find((m) => m.id === id);
  if (!entry) {
    modelStatusEl.textContent = "";
    return;
  }
  if (entry.downloaded) {
    modelDeleteBtn.hidden = false;
    modelStatusEl.textContent = "Downloaded and ready.";
  } else {
    modelDownloadBtn.hidden = false;
    modelStatusEl.textContent = `Not downloaded (${entry.sizeMB} MB from Hugging Face).`;
  }
}

modelDownloadBtn.addEventListener("click", async () => {
  const id = whisperModelEl.value;
  downloading = true;
  modelDownloadBtn.disabled = true;
  modelStatusEl.textContent = "Starting download…";
  try {
    await window.jarvis.downloadWhisperModel(id);
    modelStatusEl.textContent = "Downloaded and ready.";
  } catch (err) {
    modelStatusEl.textContent = `Download failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
  } finally {
    downloading = false;
    modelDownloadBtn.disabled = false;
    await refreshWhisperCatalog(whisperModelEl.value);
  }
});

modelDeleteBtn.addEventListener("click", async () => {
  await window.jarvis.deleteWhisperModel(whisperModelEl.value);
  await refreshWhisperCatalog(whisperModelEl.value);
});

modelBrowseBtn.addEventListener("click", async () => {
  const picked = await window.jarvis.browseWhisperModel();
  if (picked) {
    customModelPath = picked;
    updateModelStatus();
  }
});

whisperModelEl.addEventListener("change", updateModelStatus);
voiceEngineEl.addEventListener("change", updateEngineVisibility);

export function initModelProgress(): void {
  window.jarvis.onModelProgress((progress) => {
    if (!downloading || progress.id !== whisperModelEl.value) return;
    if (progress.error) {
      modelStatusEl.textContent = `Download failed: ${progress.error}`;
    } else if (!progress.done && progress.total > 0) {
      const pct = Math.floor((progress.received / progress.total) * 100);
      const mb = (progress.received / 1_048_576).toFixed(0);
      modelStatusEl.textContent = `Downloading… ${pct}% (${mb} MB)`;
    }
  });
}

/* ---------- fill / collect ---------- */

function fill(view: SettingsView): void {
  providerEl.value = view.provider;
  baseUrlEl.value = view.baseUrl;
  modelEl.value = view.model;
  orgEl.value = view.organization;
  headersEl.value = serializeHeaders(view.extraHeaders);
  ttsEl.checked = view.tts;
  apiKeyEl.value = "";
  hasStoredKey = view.hasApiKey;
  clearKey = false;
  updateKeyHint();

  voiceEngineEl.value = view.voiceEngine;
  sttLangEl.value = view.sttLanguage;
  realtimeVoiceEl.value = view.realtimeVoice;
  customModelPath = view.whisperModelPath;
  updateEngineVisibility();
  void refreshWhisperCatalog(view.whisperModel);
}

function collect(): SettingsUpdate {
  const typed = apiKeyEl.value;
  return {
    provider: providerEl.value as ProviderKind,
    baseUrl: baseUrlEl.value.trim(),
    model: modelEl.value.trim(),
    organization: orgEl.value.trim(),
    extraHeaders: parseHeaders(headersEl.value),
    tts: ttsEl.checked,
    voiceEngine: voiceEngineEl.value as VoiceEngine,
    whisperModel: whisperModelEl.value || "base.en",
    whisperModelPath: customModelPath,
    sttLanguage: sttLangEl.value,
    realtimeVoice: realtimeVoiceEl.value,
    apiKey: clearKey ? "" : typed !== "" ? typed : undefined,
  };
}

providerEl.addEventListener("change", () => {
  const kind = providerEl.value as ProviderKind;
  const isSomeDefault = Object.values(PROVIDER_DEFAULTS).some(
    (d) => d.baseUrl === baseUrlEl.value.trim()
  );
  if (baseUrlEl.value.trim() === "" || isSomeDefault) {
    baseUrlEl.value = PROVIDER_DEFAULTS[kind].baseUrl;
  }
  updateKeyHint();
});

testBtn.addEventListener("click", async () => {
  testBtn.disabled = true;
  testResult.hidden = false;
  testResult.className = "test-result";
  testResult.textContent = "Contacting provider…";
  try {
    const result = await window.jarvis.testConnection(collect());
    testResult.classList.add(result.ok ? "ok" : "fail");
    testResult.textContent = result.detail;
  } finally {
    testBtn.disabled = false;
  }
});

saveBtn.addEventListener("click", async () => {
  const view = await window.jarvis.saveSettings(collect());
  fill(view);
  onSaved(view);
  closeSettings();
});

closeBtn.addEventListener("click", () => closeSettings());

export function initSettings(
  view: SettingsView,
  savedCallback: (view: SettingsView) => void
): void {
  onSaved = savedCallback;
  initModelProgress();
  fill(view);
}

export function openSettings(noticeText?: string): void {
  notice.hidden = !noticeText;
  notice.textContent = noticeText ?? "";
  testResult.hidden = true;
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("open"));
}

export function closeSettings(): void {
  panel.classList.remove("open");
  panel.addEventListener(
    "transitionend",
    () => {
      if (!panel.classList.contains("open")) panel.hidden = true;
    },
    { once: true }
  );
}

export function isSettingsOpen(): boolean {
  return panel.classList.contains("open");
}
