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

export interface Settings extends ProviderSettings {
  /** Speak Jarvis replies aloud via speechSynthesis. */
  tts: boolean;
  /** Agent loop tool-round budget (1–32). */
  maxToolIterations: number;
  /** Additional filesystem roots besides the home directory. */
  extraRoots: string[];
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

export interface SessionMeta {
  id: string;
  title: string;
  updatedAt: string;
}

/** A feed-visible turn reconstructed from a persisted session. */
export interface ChatBubble {
  kind: "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface SessionView {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatBubble[];
}

/** The API exposed to the renderer by the preload script. */
export interface JarvisApi {
  platform: string;
  getSettings(): Promise<SettingsView>;
  saveSettings(update: SettingsUpdate): Promise<SettingsView>;
  testConnection(update: SettingsUpdate): Promise<TestConnectionResult>;
  send(text: string): void;
  retry(): void;
  cancel(): void;
  resetChat(): void;
  respondConfirm(id: string, approved: boolean): void;
  hideWindow(): void;
  listSessions(): Promise<SessionMeta[]>;
  getCurrentSession(): Promise<SessionView>;
  loadSession(id: string): Promise<SessionView>;
  deleteSession(id: string): Promise<{ sessions: SessionMeta[]; current: SessionView }>;
  newSession(): Promise<SessionView>;
  onAgentEvent(cb: (event: AgentEvent) => void): void;
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
  | { type: "error"; message: string }
  | { type: "sessions-changed"; sessions: SessionMeta[]; currentId: string };
