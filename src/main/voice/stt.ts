/**
 * Local speech-to-text via whisper.cpp (whisper-cpp-node). The native addon
 * is loaded lazily so platforms without a prebuilt binary, and unit tests,
 * never touch it. Inference runs on a native worker; the Electron main loop
 * is not blocked.
 */
import { createRequire } from "node:module";

type WhisperModule = typeof import("whisper-cpp-node");
type WhisperContext = import("whisper-cpp-node").WhisperContext;

const requireNative = createRequire(__filename);
let addon: WhisperModule | null = null;

function loadAddon(): WhisperModule {
  if (!addon) {
    addon = requireNative("whisper-cpp-node") as WhisperModule;
  }
  return addon;
}

const SAMPLE_RATE = 16_000;
/** whisper.cpp rejects clips shorter than ~1 s; pad with trailing silence. */
const MIN_SAMPLES = Math.round(SAMPLE_RATE * 1.2);

/** Drop non-speech annotations whisper emits for silence/noise. */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, " ") // [BLANK_AUDIO], [MUSIC]
    .replace(/\([^)]*\)/g, " ") // (clock ticking)
    .replace(/[♪♫]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface TranscribeRequest {
  pcm: Float32Array;
  modelPath: string;
  /** e.g. "en"; "auto" enables whisper language detection. */
  language: string;
}

export class WhisperTranscriber {
  private ctx: WhisperContext | null = null;
  private ctxModelPath = "";

  private ensureContext(modelPath: string): WhisperContext {
    if (this.ctx && this.ctxModelPath === modelPath) return this.ctx;
    this.dispose();
    const { createWhisperContext } = loadAddon();
    this.ctx = createWhisperContext({ model: modelPath, use_gpu: true, no_prints: true });
    this.ctxModelPath = modelPath;
    return this.ctx;
  }

  async transcribe(req: TranscribeRequest): Promise<string> {
    const ctx = this.ensureContext(req.modelPath);
    let pcm = req.pcm;
    if (pcm.length < MIN_SAMPLES) {
      const padded = new Float32Array(MIN_SAMPLES);
      padded.set(pcm);
      pcm = padded;
    }
    const { transcribeAsync } = loadAddon();
    const auto = req.language === "auto" || req.language === "";
    const result = await transcribeAsync(ctx, {
      pcmf32: pcm,
      language: auto ? "auto" : req.language,
      no_timestamps: true,
      suppress_blank: true,
      suppress_nst: true,
      temperature: 0,
    });
    const text = result.segments.map((s) => s.text).join(" ");
    return cleanTranscript(text);
  }

  dispose(): void {
    this.ctx?.free();
    this.ctx = null;
    this.ctxModelPath = "";
  }
}
