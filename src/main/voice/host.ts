/** Electron-side wiring for the local voice pipeline: IPC, models, session. */
import { BrowserWindow, dialog, ipcMain } from "electron";
import * as path from "node:path";
import { ModelManager } from "./models";
import { VoiceSession } from "./session";
import { WhisperTranscriber } from "./stt";
import type { PrefsStore } from "../prefs";
import type { ModelProgress, VoiceEvent, VoiceMode, WhisperModelView } from "../../shared/types";

const PROGRESS_INTERVAL_MS = 250;

/** IPC hands us a clone; make sure we end up with a real Float32Array. */
function toFloat32(chunk: unknown): Float32Array {
  if (chunk instanceof Float32Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Float32Array(chunk);
  if (ArrayBuffer.isView(chunk)) {
    const view = chunk as ArrayBufferView;
    return new Float32Array(view.buffer, view.byteOffset, view.byteLength / 4);
  }
  throw new Error("Unsupported PCM payload");
}

export class VoiceHost {
  private readonly manager: ModelManager;
  private readonly transcriber = new WhisperTranscriber();
  private readonly session: VoiceSession;

  constructor(
    private readonly window: BrowserWindow,
    private readonly prefs: PrefsStore,
    userDataDir: string
  ) {
    this.manager = new ModelManager(path.join(userDataDir, "whisper-models"));
    this.session = new VoiceSession({
      transcribe: (pcm) => this.transcribe(pcm),
      emit: (event) => this.emit(event),
    });
  }

  emit(event: VoiceEvent): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("voice-event", event);
    }
  }

  private emitProgress(progress: ModelProgress): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("voice-model-progress", progress);
    }
  }

  private resolveModelPath(): string {
    const settings = this.prefs.get();
    if (settings.whisperModel === "custom") {
      if (!settings.whisperModelPath) {
        throw new Error("No custom whisper model file selected. Open Settings.");
      }
      return settings.whisperModelPath;
    }
    if (!this.manager.isDownloaded(settings.whisperModel)) {
      throw new Error(
        `Whisper model "${settings.whisperModel}" is not downloaded. Open Settings to fetch it.`
      );
    }
    return this.manager.pathFor(settings.whisperModel);
  }

  private transcribe(pcm: Float32Array): Promise<string> {
    const settings = this.prefs.get();
    return this.transcriber.transcribe({
      pcm,
      modelPath: this.resolveModelPath(),
      language: settings.sttLanguage,
    });
  }

  private async download(id: string): Promise<void> {
    let lastEmit = 0;
    try {
      await this.manager.download(id, ({ received, total }) => {
        const now = Date.now();
        if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
          lastEmit = now;
          this.emitProgress({ id, received, total, done: false });
        }
      });
      this.emitProgress({ id, received: 1, total: 1, done: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emitProgress({ id, received: 0, total: 0, done: true, error: message });
      throw err;
    }
  }

  register(): void {
    ipcMain.on("voice:start", (_e, mode: VoiceMode) => this.session.start(mode));
    ipcMain.on("voice:stop", () => this.session.stop());
    ipcMain.on("voice:commit", () => this.session.commit());
    ipcMain.on("voice:cancel", () => this.session.cancel());
    ipcMain.on("voice:pcm", (_e, chunk: unknown) => {
      try {
        this.session.pushPcm(toFloat32(chunk));
      } catch {
        // Malformed payloads are dropped; audio is best-effort.
      }
    });

    ipcMain.handle("voice:models:list", (): WhisperModelView[] =>
      this.manager.list().map(({ id, label, sizeMB, downloaded }) => ({
        id,
        label,
        sizeMB,
        downloaded,
      }))
    );
    ipcMain.handle("voice:models:download", (_e, id: string) => this.download(id));
    ipcMain.handle("voice:models:delete", (_e, id: string) => this.manager.delete(id));
    ipcMain.handle("voice:models:browse", async (): Promise<string | null> => {
      const result = await dialog.showOpenDialog(this.window, {
        title: "Choose a ggml whisper model",
        filters: [{ name: "ggml model", extensions: ["bin", "gguf"] }],
        properties: ["openFile"],
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    });
  }

  dispose(): void {
    this.transcriber.dispose();
  }
}
