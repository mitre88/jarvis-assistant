import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VoiceSession } from "../src/main/voice/session";
import type { VoiceEvent } from "../src/shared/types";

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

function feed(session: VoiceSession, pcm: Float32Array, chunkSize = 1600): void {
  for (let i = 0; i < pcm.length; i += chunkSize) {
    session.pushPcm(pcm.subarray(i, Math.min(i + chunkSize, pcm.length)));
  }
}

async function waitFor(predicate: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function harness(transcribe: (pcm: Float32Array) => Promise<string>) {
  const events: VoiceEvent[] = [];
  const session = new VoiceSession({ transcribe, emit: (e) => events.push(e) });
  const has = (type: VoiceEvent["type"]) => events.some((e) => e.type === type);
  return { session, events, has };
}

describe("VoiceSession push-to-talk", () => {
  it("transcribes the captured audio on commit", async () => {
    const { session, events, has } = harness(async () => "open the pod bay doors");
    session.start("ptt");
    feed(session, tone(1000));
    session.commit();
    await waitFor(() => has("voice-transcript"));
    const transcript = events.find((e) => e.type === "voice-transcript");
    assert.equal((transcript as { text: string }).text, "open the pod bay doors");
    assert.ok(has("voice-listening"));
    assert.ok(has("voice-idle"));
  });

  it("reports empty when the recording is too short", () => {
    const { session, has } = harness(async () => "should never run");
    session.start("ptt");
    feed(session, tone(100));
    session.commit();
    assert.ok(has("voice-empty"));
    assert.ok(!has("voice-transcribing"));
  });
});

describe("VoiceSession auto mode", () => {
  it("segments speech and emits a transcript", async () => {
    const { session, events, has } = harness(async () => "hello there");
    session.start("auto");
    feed(session, silence(400));
    feed(session, tone(1000));
    feed(session, silence(1200));
    await waitFor(() => has("voice-transcript"));
    assert.ok(has("voice-speech-start"));
    const transcript = events.find((e) => e.type === "voice-transcript");
    assert.equal((transcript as { text: string }).text, "hello there");
  });

  it("emits voice-empty when whisper hears nothing", async () => {
    const { session, has } = harness(async () => "");
    session.start("auto");
    feed(session, tone(1000));
    feed(session, silence(1200));
    await waitFor(() => has("voice-empty"));
  });

  it("surfaces transcription failures as voice-error", async () => {
    const { session, events, has } = harness(async () => {
      throw new Error("model exploded");
    });
    session.start("auto");
    feed(session, tone(1000));
    feed(session, silence(1200));
    await waitFor(() => has("voice-error"));
    const error = events.find((e) => e.type === "voice-error");
    assert.match((error as { message: string }).message, /model exploded/);
  });

  it("cancel discards audio without transcribing", () => {
    const { session, has } = harness(async () => "should never run");
    session.start("auto");
    feed(session, tone(400));
    session.cancel();
    assert.ok(has("voice-idle"));
    assert.ok(!has("voice-transcribing"));
    assert.ok(!session.active);
  });
});
