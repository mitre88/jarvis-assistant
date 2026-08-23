/**
 * Energy-based voice activity detection with an adaptive noise floor.
 * Pure TypeScript, no native code: chunks of 16 kHz mono Float32 PCM go in,
 * speech-start / utterance events come out. Good enough for close-mic desktop
 * dictation, and fully unit-testable.
 */

export interface VadOptions {
  sampleRate?: number;
  /** Analysis frame length in ms. */
  frameMs?: number;
  /** Audio kept from before the detected speech onset. */
  preRollMs?: number;
  /** Silence needed to close an utterance. */
  endSilenceMs?: number;
  /** Utterances shorter than this are discarded as noise blips. */
  minUtteranceMs?: number;
  /** Hard cap; the utterance is emitted even if the user keeps talking. */
  maxUtteranceMs?: number;
  /** Absolute RMS floor below which nothing counts as speech. */
  minSpeechRms?: number;
  /** Speech threshold as a multiple of the tracked noise floor. */
  startFactor?: number;
  /** End-of-speech threshold as a multiple of the noise floor. */
  endFactor?: number;
}

export type VadEvent =
  | { type: "speech-start" }
  | { type: "utterance"; pcm: Float32Array };

type ResolvedOptions = Required<VadOptions>;

const DEFAULTS: ResolvedOptions = {
  sampleRate: 16_000,
  frameMs: 32,
  preRollMs: 320,
  endSilenceMs: 800,
  minUtteranceMs: 250,
  maxUtteranceMs: 30_000,
  minSpeechRms: 0.01,
  startFactor: 3.0,
  endFactor: 1.8,
};

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / Math.max(1, frame.length));
}

function concat(chunks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export class VadSegmenter {
  private readonly opts: ResolvedOptions;
  private readonly frameSamples: number;

  private pending: Float32Array[] = [];
  private pendingLen = 0;

  private preRoll: Float32Array[] = [];
  private preRollLen = 0;

  private speaking = false;
  private utterance: Float32Array[] = [];
  private utteranceLen = 0;
  private speechFrames = 0;
  private silenceMs = 0;
  /** Milliseconds of actual voiced audio in the current utterance. */
  private hotMs = 0;

  /** Exponential moving average of non-speech RMS. */
  private noiseFloor = 0.004;

  constructor(options: VadOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.frameSamples = Math.round((this.opts.sampleRate * this.opts.frameMs) / 1000);
  }

  /** Feed a chunk of PCM; returns any events it produced. */
  push(chunk: Float32Array): VadEvent[] {
    this.pending.push(chunk);
    this.pendingLen += chunk.length;

    const events: VadEvent[] = [];
    while (this.pendingLen >= this.frameSamples) {
      const frame = this.takeFrame();
      const produced = this.processFrame(frame);
      if (produced) events.push(...produced);
    }
    return events;
  }

  /** End of stream: emit whatever speech is in flight (used by push-to-talk). */
  flush(): VadEvent[] {
    const events: VadEvent[] = [];
    if (this.speaking && this.hotMs >= this.opts.minUtteranceMs) {
      events.push({ type: "utterance", pcm: concat(this.utterance, this.utteranceLen) });
    }
    this.resetSpeechState();
    return events;
  }

  reset(): void {
    this.pending = [];
    this.pendingLen = 0;
    this.resetSpeechState();
  }

  private resetSpeechState(): void {
    this.speaking = false;
    this.utterance = [];
    this.utteranceLen = 0;
    this.speechFrames = 0;
    this.silenceMs = 0;
    this.hotMs = 0;
    this.preRoll = [];
    this.preRollLen = 0;
  }

  private durationMs(samples: number): number {
    return (samples / this.opts.sampleRate) * 1000;
  }

  private takeFrame(): Float32Array {
    const out = new Float32Array(this.frameSamples);
    let needed = this.frameSamples;
    let offset = 0;
    while (needed > 0) {
      const head = this.pending[0]!;
      if (head.length <= needed) {
        out.set(head, offset);
        offset += head.length;
        needed -= head.length;
        this.pending.shift();
      } else {
        out.set(head.subarray(0, needed), offset);
        this.pending[0] = head.subarray(needed);
        needed = 0;
      }
    }
    this.pendingLen -= this.frameSamples;
    return out;
  }

  private pushPreRoll(frame: Float32Array): void {
    this.preRoll.push(frame);
    this.preRollLen += frame.length;
    const maxSamples = Math.round((this.opts.sampleRate * this.opts.preRollMs) / 1000);
    while (this.preRollLen - (this.preRoll[0]?.length ?? 0) >= maxSamples) {
      this.preRollLen -= this.preRoll.shift()!.length;
    }
  }

  private processFrame(frame: Float32Array): VadEvent[] | null {
    const level = rms(frame);
    const startThreshold = Math.max(this.opts.minSpeechRms, this.noiseFloor * this.opts.startFactor);
    const endThreshold = Math.max(this.opts.minSpeechRms * 0.6, this.noiseFloor * this.opts.endFactor);

    if (!this.speaking) {
      if (level >= startThreshold) {
        this.speechFrames++;
        this.pushPreRoll(frame);
        // Two consecutive hot frames avoid triggering on a single click/pop.
        if (this.speechFrames >= 2) {
          this.speaking = true;
          this.utterance = [...this.preRoll];
          this.utteranceLen = this.preRollLen;
          this.preRoll = [];
          this.preRollLen = 0;
          this.silenceMs = 0;
          this.hotMs = 2 * this.opts.frameMs;
          return [{ type: "speech-start" }];
        }
      } else {
        this.speechFrames = 0;
        // Only quiet frames teach the noise floor.
        this.noiseFloor = Math.max(0.0008, this.noiseFloor * 0.95 + level * 0.05);
        this.pushPreRoll(frame);
      }
      return null;
    }

    this.utterance.push(frame);
    this.utteranceLen += frame.length;

    if (level < endThreshold) {
      this.silenceMs += this.opts.frameMs;
    } else {
      this.silenceMs = 0;
      this.hotMs += this.opts.frameMs;
    }

    const tooLong = this.durationMs(this.utteranceLen) >= this.opts.maxUtteranceMs;
    if (this.silenceMs >= this.opts.endSilenceMs || tooLong) {
      const pcm = concat(this.utterance, this.utteranceLen);
      const speechMs = this.hotMs;
      this.resetSpeechState();
      // Pre-roll padding does not count as speech, so a click with a long
      // pre-roll cannot sneak past the minimum-utterance filter.
      if (speechMs < this.opts.minUtteranceMs) return null;
      return [{ type: "utterance", pcm }];
    }
    return null;
  }
}
