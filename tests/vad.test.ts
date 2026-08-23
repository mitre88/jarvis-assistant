import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rms, VadSegmenter, type VadEvent } from "../src/main/voice/vad";

const RATE = 16_000;

function silence(ms: number): Float32Array {
  return new Float32Array(Math.round((RATE * ms) / 1000));
}

function tone(ms: number, amplitude = 0.3): Float32Array {
  const samples = Math.round((RATE * ms) / 1000);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = Math.sin((2 * Math.PI * 440 * i) / RATE) * amplitude;
  }
  return out;
}

/** Feed audio in uneven chunk sizes, like the worklet would. */
function feed(vad: VadSegmenter, pcm: Float32Array, chunkSize = 1000): VadEvent[] {
  const events: VadEvent[] = [];
  for (let i = 0; i < pcm.length; i += chunkSize) {
    events.push(...vad.push(pcm.subarray(i, Math.min(i + chunkSize, pcm.length))));
  }
  return events;
}

describe("rms", () => {
  it("is zero for silence and positive for a tone", () => {
    assert.equal(rms(silence(100)), 0);
    assert.ok(rms(tone(100)) > 0.15);
  });
});

describe("VadSegmenter", () => {
  it("emits nothing for pure silence", () => {
    const vad = new VadSegmenter();
    assert.deepEqual(feed(vad, silence(3000)), []);
  });

  it("detects one utterance: speech-start then utterance after trailing silence", () => {
    const vad = new VadSegmenter();
    const events = [
      ...feed(vad, silence(500)),
      ...feed(vad, tone(1000)),
      ...feed(vad, silence(1200)),
    ];
    const starts = events.filter((e) => e.type === "speech-start");
    const utterances = events.filter((e) => e.type === "utterance");
    assert.equal(starts.length, 1);
    assert.equal(utterances.length, 1);
    const pcm = (utterances[0] as { pcm: Float32Array }).pcm;
    const durationMs = (pcm.length / RATE) * 1000;
    // Speech plus pre-roll plus closing silence — but never the leading 500 ms.
    assert.ok(durationMs >= 1000 && durationMs <= 2600, `unexpected duration ${durationMs}`);
  });

  it("discards blips shorter than the minimum utterance", () => {
    const vad = new VadSegmenter();
    const events = [
      ...feed(vad, silence(500)),
      ...feed(vad, tone(96)),
      ...feed(vad, silence(1200)),
    ];
    assert.equal(events.filter((e) => e.type === "utterance").length, 0);
  });

  it("separates two utterances", () => {
    const vad = new VadSegmenter();
    const events = [
      ...feed(vad, tone(800)),
      ...feed(vad, silence(1200)),
      ...feed(vad, tone(800)),
      ...feed(vad, silence(1200)),
    ];
    assert.equal(events.filter((e) => e.type === "utterance").length, 2);
  });

  it("force-closes an utterance at the max duration", () => {
    const vad = new VadSegmenter({ maxUtteranceMs: 2000 });
    const events = feed(vad, tone(3500));
    const utterances = events.filter((e) => e.type === "utterance");
    assert.equal(utterances.length, 1);
  });

  it("flush emits in-flight speech (push-to-talk)", () => {
    const vad = new VadSegmenter();
    feed(vad, tone(600));
    const events = vad.flush();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "utterance");
  });

  it("flush drops in-flight audio shorter than the minimum", () => {
    const vad = new VadSegmenter();
    feed(vad, tone(96));
    assert.deepEqual(vad.flush(), []);
  });
});
