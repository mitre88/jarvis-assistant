/**
 * Voice session orchestration: receives PCM from the renderer, segments it
 * (auto mode) or accumulates it (push-to-talk), transcribes utterances, and
 * reports transcripts. Electron-free — the transcriber and event sink are
 * injected.
 */
import { VadSegmenter } from "./vad";
import type { VoiceEvent, VoiceMode } from "../../shared/types";

const SAMPLE_RATE = 16_000;
/** Push-to-talk recordings are capped at 90 s. */
const MAX_PTT_SAMPLES = SAMPLE_RATE * 90;

export interface VoiceSessionDeps {
  transcribe(pcm: Float32Array): Promise<string>;
  emit(event: VoiceEvent): void;
}

export class VoiceSession {
  private mode: VoiceMode | null = null;
  private vad: VadSegmenter | null = null;
  private pttChunks: Float32Array[] = [];
  private pttLen = 0;
  /** Serializes transcriptions so utterances come out in order. */
  private work: Promise<void> = Promise.resolve();

  constructor(private readonly deps: VoiceSessionDeps) {}

  get active(): boolean {
    return this.mode !== null;
  }

  start(mode: VoiceMode): void {
    this.mode = mode;
    this.pttChunks = [];
    this.pttLen = 0;
    this.vad = mode === "auto" ? new VadSegmenter() : null;
    this.deps.emit({ type: "voice-listening", mode });
  }

  pushPcm(chunk: Float32Array): void {
    if (!this.mode) return;
    if (this.mode === "ptt") {
      if (this.pttLen + chunk.length <= MAX_PTT_SAMPLES) {
        this.pttChunks.push(chunk);
        this.pttLen += chunk.length;
      }
      return;
    }
    for (const event of this.vad!.push(chunk)) {
      if (event.type === "speech-start") {
        this.deps.emit({ type: "voice-speech-start" });
      } else {
        this.enqueueTranscription(event.pcm);
      }
    }
  }

  /** Push-to-talk release: transcribe everything captured. */
  commit(): void {
    if (this.mode !== "ptt") return;
    const pcm = this.concatPtt();
    this.mode = null;
    if (pcm.length > SAMPLE_RATE * 0.3) {
      this.enqueueTranscription(pcm);
    } else {
      this.deps.emit({ type: "voice-empty" });
    }
    this.deps.emit({ type: "voice-idle" });
  }

  cancel(): void {
    this.reset();
    this.deps.emit({ type: "voice-idle" });
  }

  stop(): void {
    this.reset();
    this.deps.emit({ type: "voice-idle" });
  }

  private reset(): void {
    this.mode = null;
    this.vad = null;
    this.pttChunks = [];
    this.pttLen = 0;
  }

  private concatPtt(): Float32Array {
    const out = new Float32Array(this.pttLen);
    let offset = 0;
    for (const c of this.pttChunks) {
      out.set(c, offset);
      offset += c.length;
    }
    this.pttChunks = [];
    this.pttLen = 0;
    return out;
  }

  private enqueueTranscription(pcm: Float32Array): void {
    this.work = this.work.then(async () => {
      this.deps.emit({ type: "voice-transcribing" });
      try {
        const text = await this.deps.transcribe(pcm);
        if (text) {
          this.deps.emit({ type: "voice-transcript", text });
        } else {
          this.deps.emit({ type: "voice-empty" });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.deps.emit({ type: "voice-error", message });
      }
    });
  }
}
