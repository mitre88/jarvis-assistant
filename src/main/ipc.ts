/** IPC surface: settings, connection test, agent runs, confirmations. */
import {
  BrowserWindow,
  Notification,
  clipboard,
  ipcMain,
  shell,
} from "electron";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { runAgent } from "../agent/loop";
import { SYSTEM_PROMPT } from "../agent/prompt";
import { createProvider, testConnection, type ProviderHttpConfig } from "../agent/providers";
import { buildRealtimeSessionPayload, REALTIME_MODEL } from "../agent/realtime";
import { createStandardRegistry } from "../agent/tools";
import type { ToolContext } from "../agent/tools/context";
import type { Msg } from "../agent/types";
import type {
  AgentEvent,
  RealtimeSessionGrant,
  SettingsUpdate,
  SettingsView,
} from "../shared/types";
import type { PrefsStore } from "./prefs";
import type { SecretStore } from "./secrets";

export class AgentHost {
  private messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];
  private registry = createStandardRegistry();
  private abort: AbortController | null = null;
  private pendingConfirms = new Map<string, (approved: boolean) => void>();

  constructor(
    private window: BrowserWindow,
    private prefs: PrefsStore,
    private secrets: SecretStore,
    private userDataDir: string
  ) {}

  private emit(event: AgentEvent): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("agent-event", event);
    }
  }

  private settingsView(): SettingsView {
    return { ...this.prefs.get(), hasApiKey: this.secrets.hasApiKey() };
  }

  private providerConfig(override?: SettingsUpdate): {
    kind: SettingsUpdate["provider"];
    cfg: ProviderHttpConfig;
  } {
    const s = override ?? this.prefs.get();
    const apiKey =
      override && override.apiKey !== undefined && override.apiKey !== ""
        ? override.apiKey
        : this.secrets.getApiKey();
    return {
      kind: s.provider,
      cfg: {
        baseUrl: s.baseUrl,
        apiKey,
        model: s.model,
        organization: s.organization,
        extraHeaders: s.extraHeaders,
      },
    };
  }

  private toolContext(): ToolContext {
    const home = os.homedir();
    return {
      roots: [home],
      home,
      memoryFile: path.join(this.userDataDir, "memory.json"),
      confirm: (req) => this.requestConfirmation(req.title, req.detail),
      clipboard: {
        readText: () => clipboard.readText(),
        writeText: (text) => clipboard.writeText(text),
      },
      openExternal: (url) => shell.openExternal(url),
      openPath: (p) => shell.openPath(p),
      notify: (title, body) => {
        new Notification({ title, body }).show();
      },
    };
  }

  private requestConfirmation(title: string, detail: string): Promise<boolean> {
    const id = randomUUID();
    return new Promise((resolve) => {
      this.pendingConfirms.set(id, resolve);
      this.window.show();
      this.emit({ type: "confirm-request", request: { id, title, detail } });
    });
  }

  register(): void {
    ipcMain.handle("settings:get", () => this.settingsView());

    ipcMain.handle("settings:save", (_e, update: SettingsUpdate) => {
      const { apiKey, ...settings } = update;
      this.prefs.set(settings);
      if (apiKey !== undefined) this.secrets.setApiKey(apiKey);
      return this.settingsView();
    });

    ipcMain.handle("settings:test", (_e, update: SettingsUpdate) => {
      const { kind, cfg } = this.providerConfig(update);
      return testConnection(kind, cfg);
    });

    ipcMain.on("chat:send", (_e, text: string) => {
      void this.run(text);
    });

    ipcMain.on("chat:cancel", () => this.abort?.abort());

    ipcMain.on("chat:reset", () => {
      this.abort?.abort();
      this.messages = [{ role: "system", content: SYSTEM_PROMPT }];
    });

    ipcMain.on("confirm:response", (_e, id: string, approved: boolean) => {
      const resolve = this.pendingConfirms.get(id);
      if (resolve) {
        this.pendingConfirms.delete(id);
        this.emit({ type: "confirm-settled", id });
        resolve(approved);
      }
    });

    ipcMain.on("window:hide", () => this.window.hide());

    // Realtime tool bridge: the renderer's Realtime session executes tools
    // through the same registry, context, and approval flow as the agent loop.
    ipcMain.handle("tools:execute", (_e, name: string, argsJson: string) =>
      this.registry.execute(name, argsJson, this.toolContext())
    );

    ipcMain.handle("realtime:session", () => this.createRealtimeSession());
  }

  private async createRealtimeSession(): Promise<RealtimeSessionGrant> {
    const settings = this.prefs.get();
    const apiKey = this.secrets.getApiKey();
    if (!apiKey) {
      throw new Error("Realtime voice needs an OpenAI API key. Open Settings.");
    }
    if (!settings.baseUrl.includes("api.openai.com")) {
      throw new Error("Realtime voice is only available with api.openai.com as the base URL.");
    }
    const baseUrl = "https://api.openai.com";
    const payload = buildRealtimeSessionPayload({
      voice: settings.realtimeVoice,
      instructions: SYSTEM_PROMPT,
      tools: this.registry.specs(),
    });
    const response = await fetch(`${baseUrl}/v1/realtime/client_secrets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Could not create a Realtime session: HTTP ${response.status}${
          detail ? ` — ${detail.slice(0, 200)}` : ""
        }`
      );
    }
    const data = (await response.json()) as { value?: string };
    if (!data.value) {
      throw new Error("Realtime session response had no client secret.");
    }
    return { clientSecret: data.value, model: REALTIME_MODEL, baseUrl };
  }

  private async run(text: string): Promise<void> {
    if (this.abort) return; // one run at a time; renderer disables send too
    const { kind, cfg } = this.providerConfig();
    if (!cfg.model) {
      this.emit({ type: "error", message: "No model configured. Open Settings first." });
      return;
    }
    this.abort = new AbortController();
    this.messages.push({ role: "user", content: text });
    this.emit({ type: "run-start" });
    try {
      const final = await runAgent({
        provider: createProvider(kind, cfg),
        messages: this.messages,
        registry: this.registry,
        ctx: this.toolContext(),
        signal: this.abort.signal,
        onEvent: (e) => this.emit(e),
      });
      this.emit({ type: "done", text: final });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: "error", message });
    } finally {
      // Deny anything still waiting; its run is over.
      for (const [id, resolve] of this.pendingConfirms) {
        this.emit({ type: "confirm-settled", id });
        resolve(false);
      }
      this.pendingConfirms.clear();
      this.abort = null;
    }
  }
}
