/** Settings panel: provider config, connection test, persistence. */
import { PROVIDER_DEFAULTS } from "../shared/provider-defaults.js";
import type { ProviderKind, SettingsUpdate, SettingsView } from "../shared/types.js";
import { showToast } from "./toast.js";

const panel = document.getElementById("settings-panel") as HTMLElement;
const backdrop = document.getElementById("settings-backdrop") as HTMLElement;
const notice = document.getElementById("settings-notice") as HTMLElement;
const providerEl = document.getElementById("s-provider") as HTMLSelectElement;
const baseUrlEl = document.getElementById("s-baseurl") as HTMLInputElement;
const apiKeyEl = document.getElementById("s-apikey") as HTMLInputElement;
const apiKeyHint = document.getElementById("s-apikey-hint") as HTMLElement;
const modelEl = document.getElementById("s-model") as HTMLInputElement;
const modelList = document.getElementById("s-models") as HTMLDataListElement;
const orgEl = document.getElementById("s-org") as HTMLInputElement;
const headersEl = document.getElementById("s-headers") as HTMLTextAreaElement;
const iterationsEl = document.getElementById("s-iterations") as HTMLInputElement;
const rootsEl = document.getElementById("s-roots") as HTMLTextAreaElement;
const ttsEl = document.getElementById("s-tts") as HTMLInputElement;
const testBtn = document.getElementById("s-test") as HTMLButtonElement;
const saveBtn = document.getElementById("s-save") as HTMLButtonElement;
const closeBtn = document.getElementById("s-close") as HTMLButtonElement;
const testResult = document.getElementById("s-test-result") as HTMLElement;

let hasStoredKey = false;
let clearKey = false;
let onSaved: (view: SettingsView) => void = () => {};

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

function fillModelList(models: string[] | undefined): void {
  modelList.replaceChildren();
  for (const m of models ?? []) {
    const opt = document.createElement("option");
    opt.value = m;
    modelList.append(opt);
  }
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

function fill(view: SettingsView): void {
  providerEl.value = view.provider;
  baseUrlEl.value = view.baseUrl;
  modelEl.value = view.model;
  orgEl.value = view.organization;
  headersEl.value = serializeHeaders(view.extraHeaders);
  iterationsEl.value = String(view.maxToolIterations ?? 8);
  rootsEl.value = (view.extraRoots ?? []).join("\n");
  ttsEl.checked = view.tts;
  apiKeyEl.value = "";
  hasStoredKey = view.hasApiKey;
  clearKey = false;
  updateKeyHint();
}

function collect(): SettingsUpdate {
  const typed = apiKeyEl.value;
  const iterations = Number(iterationsEl.value);
  return {
    provider: providerEl.value as ProviderKind,
    baseUrl: baseUrlEl.value.trim(),
    model: modelEl.value.trim(),
    organization: orgEl.value.trim(),
    extraHeaders: parseHeaders(headersEl.value),
    tts: ttsEl.checked,
    maxToolIterations: Number.isFinite(iterations) ? iterations : 8,
    extraRoots: rootsEl.value
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
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
    fillModelList(result.models);
    showToast(result.ok ? result.detail : "Connection failed", result.ok ? "ok" : "err");
  } finally {
    testBtn.disabled = false;
  }
});

saveBtn.addEventListener("click", async () => {
  const view = await window.jarvis.saveSettings(collect());
  fill(view);
  onSaved(view);
  showToast("Settings saved", "ok");
  closeSettings();
});

closeBtn.addEventListener("click", () => closeSettings());
backdrop.addEventListener("click", () => closeSettings());

export function initSettings(
  view: SettingsView,
  savedCallback: (view: SettingsView) => void
): void {
  onSaved = savedCallback;
  fill(view);
}

export function openSettings(noticeText?: string): void {
  notice.hidden = !noticeText;
  notice.textContent = noticeText ?? "";
  testResult.hidden = true;
  panel.hidden = false;
  backdrop.hidden = false;
  requestAnimationFrame(() => {
    panel.classList.add("open");
    backdrop.classList.add("open");
  });
}

export function closeSettings(): void {
  panel.classList.remove("open");
  backdrop.classList.remove("open");
  panel.addEventListener(
    "transitionend",
    () => {
      if (!panel.classList.contains("open")) {
        panel.hidden = true;
        backdrop.hidden = true;
      }
    },
    { once: true }
  );
}

export function isSettingsOpen(): boolean {
  return panel.classList.contains("open");
}
