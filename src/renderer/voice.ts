/**
 * Renderer side of the local voice pipeline: microphone capture through an
 * AudioWorklet, PCM streaming to main, and voice-state bookkeeping for the UI.
 */
import type { VoiceEvent, VoiceMode } from "../shared/types.js";

export type VoiceUiState =
  | "off"
  | "starting"
  | "listening"
  | "speech"
  | "transcribing";

export interface VoiceHandlers {
  onState(state: VoiceUiState): void;
  /** Mic level 0..1, ~8 times per second while capturing. */
  onLevel(level: number): void;
  onTranscript(text: string): void;
  onNotice(message: string): void;
  /** Global shortcut pressed; the app decides which engine to toggle. */
  onHotkey(): void;
}

let handlers: VoiceHandlers | null = null;

let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;

let mode: VoiceMode | null = null;
let state: VoiceUiState = "off";
let capturePaused = false;

function setState(next: VoiceUiState): void {
  state = next;
  handlers?.onState(next);
}

export function voiceState(): VoiceUiState {
  return state;
}

export function isListening(): boolean {
  return mode !== null;
}

/** Pause PCM streaming (agent run / TTS playback) without dropping the mic. */
export function setCapturePaused(paused: boolean): void {
  capturePaused = paused;
}

async function ensureCapture(): Promise<void> {
  if (stream && audioCtx && workletNode) return;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  audioCtx = new AudioContext({ sampleRate: 16_000 });
  await audioCtx.audioWorklet.addModule("./voice-worklet.js");
  const source = audioCtx.createMediaStreamSource(stream);
  workletNode = new AudioWorkletNode(audioCtx, "pcm-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
  });
  workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const pcm = event.data;
    let sum = 0;
    for (let i = 0; i < pcm.length; i += 4) sum += pcm[i]! * pcm[i]!;
    handlers?.onLevel(Math.min(1, Math.sqrt(sum / Math.max(1, pcm.length / 4)) * 6));
    if (mode && !capturePaused) window.jarvis.sendPcm(pcm);
  };
  source.connect(workletNode);
}

function teardownCapture(): void {
  workletNode?.port.close();
  workletNode?.disconnect();
  workletNode = null;
  void audioCtx?.close();
  audioCtx = null;
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
}

export async function startListening(requested: VoiceMode = "auto"): Promise<void> {
  if (mode) return;
  setState("starting");
  try {
    await ensureCapture();
  } catch (err) {
    teardownCapture();
    setState("off");
    handlers?.onNotice(
      err instanceof DOMException && err.name === "NotAllowedError"
        ? "Microphone access was denied."
        : `Microphone unavailable: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }
  mode = requested;
  capturePaused = false;
  window.jarvis.startVoice(requested);
}

export function stopListening(): void {
  if (!mode) return;
  const wasPtt = mode === "ptt";
  mode = null;
  if (wasPtt) {
    window.jarvis.commitVoice();
  } else {
    window.jarvis.stopVoice();
  }
  teardownCapture();
  handlers?.onLevel(0);
  // "transcribing" may still arrive for an in-flight utterance; that's fine.
  if (state !== "transcribing") setState("off");
}

export async function toggleListening(): Promise<void> {
  if (mode) {
    stopListening();
  } else {
    await startListening("auto");
  }
}

/** Push-to-talk: hold to record, release to transcribe. */
export async function startPushToTalk(): Promise<void> {
  if (mode) return;
  await startListening("ptt");
}

export function endPushToTalk(): void {
  if (mode !== "ptt") return;
  stopListening();
}

export function initVoice(h: VoiceHandlers): void {
  handlers = h;
  window.jarvis.onVoiceEvent((event: VoiceEvent) => {
    switch (event.type) {
      case "voice-listening":
        setState("listening");
        break;
      case "voice-speech-start":
        setState("speech");
        break;
      case "voice-transcribing":
        setState("transcribing");
        break;
      case "voice-transcript":
        setState(mode ? "listening" : "off");
        h.onTranscript(event.text);
        break;
      case "voice-empty":
        setState(mode ? "listening" : "off");
        if (!mode) h.onNotice("Didn't catch that.");
        break;
      case "voice-idle":
        if (!mode) setState("off");
        break;
      case "voice-error":
        mode = null;
        teardownCapture();
        setState("off");
        h.onNotice(event.message);
        break;
      case "voice-toggle-hotkey":
        h.onHotkey();
        break;
    }
  });
}
