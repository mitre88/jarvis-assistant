/**
 * Whisper model catalog and download manager. Models are ggml files from the
 * official whisper.cpp collection on Hugging Face, stored in the app's
 * userData directory. Electron-free: the storage dir and fetch are injected,
 * which keeps this testable.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";

export interface WhisperModelInfo {
  id: string;
  label: string;
  sizeMB: number;
}

const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export const WHISPER_MODELS: readonly WhisperModelInfo[] = [
  { id: "tiny.en", label: "Tiny (English) — fastest", sizeMB: 78 },
  { id: "base.en", label: "Base (English) — recommended", sizeMB: 148 },
  { id: "small.en", label: "Small (English) — more accurate", sizeMB: 488 },
  { id: "medium.en", label: "Medium (English) — high accuracy", sizeMB: 1530 },
  { id: "tiny", label: "Tiny (multilingual)", sizeMB: 78 },
  { id: "base", label: "Base (multilingual)", sizeMB: 148 },
  { id: "small", label: "Small (multilingual)", sizeMB: 488 },
  { id: "large-v3-turbo", label: "Large v3 Turbo (multilingual) — best", sizeMB: 1620 },
];

export function modelUrl(id: string): string {
  return `${HF_BASE}/ggml-${id}.bin`;
}

export interface DownloadProgress {
  received: number;
  total: number;
}

export class ModelManager {
  constructor(
    private readonly dir: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  pathFor(id: string): string {
    return path.join(this.dir, `ggml-${id}.bin`);
  }

  isDownloaded(id: string): boolean {
    try {
      return fs.statSync(this.pathFor(id)).size > 0;
    } catch {
      return false;
    }
  }

  list(): (WhisperModelInfo & { downloaded: boolean })[] {
    return WHISPER_MODELS.map((m) => ({ ...m, downloaded: this.isDownloaded(m.id) }));
  }

  delete(id: string): void {
    fs.rmSync(this.pathFor(id), { force: true });
  }

  /**
   * Download a model to `<dir>/ggml-<id>.bin`. Writes to a .part file and
   * renames on success so a torn download never looks like a usable model.
   */
  async download(id: string, onProgress?: (p: DownloadProgress) => void): Promise<string> {
    if (!WHISPER_MODELS.some((m) => m.id === id)) {
      throw new Error(`Unknown whisper model: ${id}`);
    }
    const target = this.pathFor(id);
    if (this.isDownloaded(id)) return target;

    fs.mkdirSync(this.dir, { recursive: true });
    const partial = `${target}.part`;

    const response = await this.fetchImpl(modelUrl(id));
    if (!response.ok || !response.body) {
      throw new Error(`Model download failed: HTTP ${response.status}`);
    }
    const total = Number(response.headers.get("content-length") ?? 0);
    let received = 0;

    const file = fs.createWriteStream(partial);
    const counter = new Writable({
      write(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        onProgress?.({ received, total });
        file.write(chunk, cb);
      },
      final(cb) {
        file.end(cb);
      },
    });

    try {
      await pipeline(response.body as unknown as NodeJS.ReadableStream, counter);
      fs.renameSync(partial, target);
    } catch (err) {
      fs.rmSync(partial, { force: true });
      throw err;
    }
    return target;
  }
}
