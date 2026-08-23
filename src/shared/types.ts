/** Types shared between main, agent, and renderer. Types only — no runtime code. */

export type ProviderKind = "openai" | "anthropic" | "ollama" | "lmstudio";

export interface ProviderSettings {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  organization: string;
  /** Extra HTTP headers, e.g. for proxies or exotic gateways. */
  extraHeaders: Record<string, string>;
}

/** Which engine handles spoken input. */
export type VoiceEngine = "whisper" | "realtime";

export interface VoiceSettings {
  voiceEngine: VoiceEngine;
  /** Catalog id of the whisper model, or "custom" for a user-picked file. */
  whisperModel: string;
  /** Absolute path to a ggml model file when whisperModel === "custom". */
  whisperModelPath: string;
  /** Language hint for local transcription ("auto" to detect). */
  sttLanguage: string;
  /** Voice used by the OpenAI Realtime session. */
  realtimeVoice: string;
}

export interface Settings extends ProviderSettings, VoiceSettings {
  /** Speak Jarvis replies aloud via speechSynthesis. */
  tts: boolean;
}

/** What the renderer sees. The API key itself never crosses the bridge. */
export interface SettingsView extends Settings {
  hasApiKey: boolean;
}

/** Settings update from the renderer. apiKey: undefined = keep, "" = clear. */
export interface SettingsUpdate extends Settings {
  apiKey?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  /** e.g. "17 models available" or "model 'x' found" */
  detail: string;
  models?: string[];
}

/** A request from a tool for explicit user approval. */
export interface ConfirmRequest {
  id: string;
  title: string;
  /** e.g. the command line or file path involved. */
  detail: string;
}

/** One entry of the whisper model catalog, as shown in Settings. */
export interface WhisperModelView {
  id: string;
  label: string;
  sizeMB: number;
  downloaded: boolean;
}

/** Download progress for a whisper model. */
export interface ModelProgress {
  id: string;
  received: number;
  total: number;
  done: boolean;
  error?: string;
}

export type VoiceMode = "ptt" | "auto";

/** Events streamed from the voice pipeline (main) to the renderer. */
export type VoiceEvent =
  | { type: "voice-listening"; mode: VoiceMode }
  | { type: "voice-speech-start" }
  | { type: "voice-transcribing" }
  | { type: "voice-transcript"; text: string }
  | { type: "voice-empty" }
  | { type: "voice-idle" }
  | { type: "voice-error"; message: string }
  | { type: "voice-toggle-hotkey" };

/** Everything the renderer needs to open a Realtime session. */
export interface RealtimeSessionGrant {
  /** Ephemeral client secret (ek_...); safe to hand to the renderer. */
  clientSecret: string;
  model: string;
  baseUrl: string;
}

/** The API exposed to the renderer by the preload script. */
export interface JarvisApi {
  getSettings(): Promise<SettingsView>;
  saveSettings(update: SettingsUpdate): Promise<SettingsView>;
  testConnection(update: SettingsUpdate): Promise<TestConnectionResult>;
  send(text: string): void;
  cancel(): void;
  resetChat(): void;
  respondConfirm(id: string, approved: boolean): void;
  hideWindow(): void;
  onAgentEvent(cb: (event: AgentEvent) => void): void;

  // Voice: local whisper pipeline
  startVoice(mode: VoiceMode): void;
  stopVoice(): void;
  commitVoice(): void;
  cancelVoice(): void;
  sendPcm(chunk: Float32Array): void;
  onVoiceEvent(cb: (event: VoiceEvent) => void): void;

  // Voice: whisper model management
  listWhisperModels(): Promise<WhisperModelView[]>;
  downloadWhisperModel(id: string): Promise<void>;
  deleteWhisperModel(id: string): Promise<void>;
  browseWhisperModel(): Promise<string | null>;
  onModelProgress(cb: (progress: ModelProgress) => void): void;

  // Voice: OpenAI Realtime
  createRealtimeSession(): Promise<RealtimeSessionGrant>;
  executeTool(name: string, argsJson: string): Promise<{ content: string; isError: boolean }>;
}

/** Events streamed from the agent loop to the renderer. */
export type AgentEvent =
  | { type: "run-start" }
  | { type: "token"; text: string }
  | { type: "tool-call"; name: string; summary: string }
  | { type: "tool-result"; name: string; summary: string; isError: boolean }
  | { type: "confirm-request"; request: ConfirmRequest }
  | { type: "confirm-settled"; id: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };
