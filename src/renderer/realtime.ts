/**
 * OpenAI Realtime voice mode: a WebRTC session straight from the renderer,
 * authenticated with an ephemeral client secret minted by the main process.
 * Audio flows over the peer connection; events over the data channel. Tool
 * calls are bridged back to the main-process registry, so approvals work
 * exactly like they do for the local agent loop.
 */
import {
  errorMessage,
  eventType,
  extractFunctionCalls,
  functionCallOutputEvent,
  responseCreateEvent,
  transcriptDelta,
  userTranscript,
  userTextEvent,
} from "../shared/realtime-events.js";

export type RealtimeState = "off" | "connecting" | "live" | "speaking" | "user-speech";

export interface RealtimeHandlers {
  onState(state: RealtimeState): void;
  /** Mic level 0..1 while the session is live. */
  onLevel(level: number): void;
  onUserTranscript(text: string): void;
  onAssistantDelta(text: string): void;
  onAssistantDone(): void;
  onToolCall(name: string, summary: string): void;
  onToolResult(name: string, summary: string, isError: boolean): void;
  onNotice(message: string): void;
}

let handlers: RealtimeHandlers | null = null;
let state: RealtimeState = "off";

let pc: RTCPeerConnection | null = null;
let dc: RTCDataChannel | null = null;
let mic: MediaStream | null = null;
let audioEl: HTMLAudioElement | null = null;
let levelCtx: AudioContext | null = null;
let levelTimer = 0;

function setState(next: RealtimeState): void {
  state = next;
  handlers?.onState(next);
}

export function isRealtimeActive(): boolean {
  return state !== "off";
}

function summarize(text: string, cap = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > cap ? `${flat.slice(0, cap)}…` : flat;
}

function startLevelMeter(stream: MediaStream): void {
  levelCtx = new AudioContext();
  const source = levelCtx.createMediaStreamSource(stream);
  const analyser = levelCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  levelTimer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i]! * data[i]!;
    handlers?.onLevel(Math.min(1, Math.sqrt(sum / (data.length / 4)) * 6));
  }, 100);
}

function teardown(): void {
  window.clearInterval(levelTimer);
  levelTimer = 0;
  void levelCtx?.close();
  levelCtx = null;
  dc?.close();
  dc = null;
  pc?.close();
  pc = null;
  for (const track of mic?.getTracks() ?? []) track.stop();
  mic = null;
  if (audioEl) {
    audioEl.srcObject = null;
    audioEl = null;
  }
  handlers?.onLevel(0);
}

export function stopRealtime(): void {
  teardown();
  setState("off");
}

export function sendRealtimeText(text: string): void {
  if (!dc || dc.readyState !== "open") return;
  dc.send(JSON.stringify(userTextEvent(text)));
  dc.send(JSON.stringify(responseCreateEvent()));
}

async function runToolCalls(event: unknown): Promise<void> {
  const calls = extractFunctionCalls(event);
  if (calls.length === 0 || !dc || dc.readyState !== "open") return;
  for (const call of calls) {
    handlers?.onToolCall(call.name, summarize(call.arguments));
    const outcome = await window.jarvis.executeTool(call.name, call.arguments);
    handlers?.onToolResult(call.name, summarize(outcome.content), outcome.isError);
    if (dc?.readyState === "open") {
      dc.send(JSON.stringify(functionCallOutputEvent(call.callId, outcome.content)));
    }
  }
  if (dc?.readyState === "open") {
    dc.send(JSON.stringify(responseCreateEvent()));
  }
}

function handleServerEvent(raw: string): void {
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  switch (eventType(event)) {
    case "input_audio_buffer.speech_started":
      setState("user-speech");
      break;
    case "input_audio_buffer.speech_stopped":
      if (state === "user-speech") setState("live");
      break;
    case "conversation.item.input_audio_transcription.completed": {
      const text = userTranscript(event);
      if (text) handlers?.onUserTranscript(text);
      break;
    }
    case "response.output_audio_transcript.delta": {
      const delta = transcriptDelta(event);
      if (delta) handlers?.onAssistantDelta(delta);
      break;
    }
    case "output_audio_buffer.started":
      setState("speaking");
      break;
    case "output_audio_buffer.stopped":
    case "output_audio_buffer.cleared":
      if (state === "speaking") setState("live");
      break;
    case "response.done":
      handlers?.onAssistantDone();
      void runToolCalls(event);
      break;
    case "error":
      handlers?.onNotice(errorMessage(event));
      break;
  }
}

async function connect(): Promise<void> {
  setState("connecting");
  try {
    const grant = await window.jarvis.createRealtimeSession();

    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    pc = new RTCPeerConnection();
    for (const track of mic.getTracks()) pc.addTrack(track, mic);

    audioEl = new Audio();
    audioEl.autoplay = true;
    pc.ontrack = (event) => {
      if (audioEl && event.streams[0]) audioEl.srcObject = event.streams[0];
    };
    pc.onconnectionstatechange = () => {
      const s = pc?.connectionState;
      if (s === "failed" || s === "disconnected" || s === "closed") {
        if (state !== "off") {
          handlers?.onNotice("Realtime connection lost.");
          stopRealtime();
        }
      }
    };

    dc = pc.createDataChannel("oai-events");
    dc.onmessage = (event) => handleServerEvent(String(event.data));
    dc.onopen = () => setState("live");

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const response = await fetch(
      `${grant.baseUrl}/v1/realtime/calls?model=${encodeURIComponent(grant.model)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${grant.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      }
    );
    if (!response.ok) {
      throw new Error(`Realtime handshake failed: HTTP ${response.status}`);
    }
    await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });

    startLevelMeter(mic);
  } catch (err) {
    teardown();
    setState("off");
    handlers?.onNotice(
      err instanceof Error ? err.message : "Could not start the Realtime session."
    );
  }
}

export async function toggleRealtime(): Promise<void> {
  if (isRealtimeActive()) {
    stopRealtime();
  } else {
    await connect();
  }
}

export function initRealtime(h: RealtimeHandlers): void {
  handlers = h;
}
