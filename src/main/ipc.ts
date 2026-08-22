/** IPC surface: settings, connection test, agent runs, confirmations, sessions. */
import {
  BrowserWindow,
  Notification,
  clipboard,
  ipcMain,
  shell,
} from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { runAgent } from "../agent/loop";
import { upsertMemoryMessage } from "../agent/memory-context";
import { SYSTEM_PROMPT } from "../agent/prompt";
import { createProvider, testConnection, type ProviderHttpConfig } from "../agent/providers";
import { createStandardRegistry } from "../agent/tools";
import type { ToolContext } from "../agent/tools/context";
import { recentNotesText } from "../agent/tools/memory";
import type {
  AgentEvent,
  SessionMeta,
  SessionView,
  SettingsUpdate,
  SettingsView,
} from "../shared/types";
import type { PrefsStore } from "./prefs";
import { clampIterations } from "./prefs";
import type { SecretStore } from "./secrets";
import { SessionStore, toSessionView, type SessionRecord } from "./sessions";

const CONFIRM_TIMEOUT_MS = 60_000;

function resolveExtraRoots(home: string, extra: string[]): string[] {
  const roots = [home];
  const seen = new Set([path.resolve(home)]);
  for (const r of extra) {
    try {
      const abs = path.resolve(r);
      if (!fs.existsSync(abs)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      roots.push(abs);
    } catch {
      // skip
    }
  }
  return roots;
}

export class AgentHost {
  private store: SessionStore;
  private session: SessionRecord;
  private registry = createStandardRegistry();
  private abort: AbortController | null = null;
  private pendingConfirms = new Map<string, (approved: boolean) => void>();

  constructor(
    private window: BrowserWindow,
    private prefs: PrefsStore,
    private secrets: SecretStore,
    private userDataDir: string
  ) {
    this.store = new SessionStore(path.join(userDataDir, "sessions"));
    this.session = this.store.latest() ?? this.store.create(SYSTEM_PROMPT);
  }

  private emit(event: AgentEvent): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("agent-event", event);
    }
  }

  private persistAndBroadcast(): void {
    this.store.save(this.session);
    this.emit({
      type: "sessions-changed",
      sessions: this.store.list(),
      currentId: this.session.id,
    });
  }

  private sessionView(): SessionView {
    return toSessionView(this.session);
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
    const extra = this.prefs.get().extraRoots;
    return {
      roots: resolveExtraRoots(home, extra),
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
      let settled = false;
      const finish = (approved: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingConfirms.delete(id);
        this.emit({ type: "confirm-settled", id });
        resolve(approved);
      };
      const timer = setTimeout(() => finish(false), CONFIRM_TIMEOUT_MS);
      this.pendingConfirms.set(id, finish);
      this.window.show();
      this.emit({ type: "confirm-request", request: { id, title, detail } });
    });
  }

  private startNewSession(): SessionView {
    this.abort?.abort();
    this.abort = null;
    this.session = this.store.create(SYSTEM_PROMPT);
    this.emit({
      type: "sessions-changed",
      sessions: this.store.list(),
      currentId: this.session.id,
    });
    return this.sessionView();
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

    ipcMain.handle("sessions:list", (): SessionMeta[] => this.store.list());
    ipcMain.handle("sessions:current", (): SessionView => this.sessionView());

    ipcMain.handle("sessions:load", (_e, id: string): SessionView => {
      const rec = this.store.load(id);
      if (!rec) throw new Error("Session not found");
      this.abort?.abort();
      this.abort = null;
      this.session = rec;
      return this.sessionView();
    });

    ipcMain.handle(
      "sessions:delete",
      (_e, id: string): { sessions: SessionMeta[]; current: SessionView } => {
        this.store.delete(id);
        if (this.session.id === id) {
          this.abort?.abort();
          this.abort = null;
          this.session = this.store.latest() ?? this.store.create(SYSTEM_PROMPT);
        }
        return { sessions: this.store.list(), current: this.sessionView() };
      }
    );

    ipcMain.handle("sessions:new", (): SessionView => this.startNewSession());

    ipcMain.on("chat:send", (_e, text: string) => {
      void this.run(text);
    });

    ipcMain.on("chat:retry", () => {
      void this.retry();
    });

    ipcMain.on("chat:cancel", () => this.abort?.abort());

    ipcMain.on("chat:reset", () => {
      this.startNewSession();
    });

    ipcMain.on("confirm:response", (_e, id: string, approved: boolean) => {
      const resolve = this.pendingConfirms.get(id);
      if (resolve) resolve(approved);
    });

    ipcMain.on("window:hide", () => this.window.hide());
  }

  private lastUserIndex(): number {
    for (let i = this.session.messages.length - 1; i >= 0; i--) {
      if (this.session.messages[i]?.role === "user") return i;
    }
    return -1;
  }

  private async retry(): Promise<void> {
    if (this.abort) return;
    const idx = this.lastUserIndex();
    if (idx < 0) {
      this.emit({ type: "error", message: "Nothing to retry." });
      return;
    }
    this.session.messages = this.session.messages.slice(0, idx + 1);
    await this.executeRun();
  }

  private async run(text: string): Promise<void> {
    if (this.abort) return;
    this.session.messages.push({ role: "user", content: text });
    await this.executeRun();
  }

  private async executeRun(): Promise<void> {
    if (this.abort) return;
    const { kind, cfg } = this.providerConfig();
    if (!cfg.model) {
      this.emit({ type: "error", message: "No model configured. Open Settings first." });
      return;
    }
    this.abort = new AbortController();
    const memoryFile = path.join(this.userDataDir, "memory.json");
    upsertMemoryMessage(this.session.messages, await recentNotesText(memoryFile));
    this.persistAndBroadcast();
    this.emit({ type: "run-start" });
    try {
      const final = await runAgent({
        provider: createProvider(kind, cfg),
        messages: this.session.messages,
        registry: this.registry,
        ctx: { ...this.toolContext(), signal: this.abort.signal },
        signal: this.abort.signal,
        maxToolIterations: clampIterations(this.prefs.get().maxToolIterations),
        onEvent: (e) => this.emit(e),
      });
      this.emit({ type: "done", text: final });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: "error", message });
    } finally {
      for (const [id, resolve] of this.pendingConfirms) {
        this.emit({ type: "confirm-settled", id });
        resolve(false);
      }
      this.pendingConfirms.clear();
      this.abort = null;
      this.persistAndBroadcast();
    }
  }
}
