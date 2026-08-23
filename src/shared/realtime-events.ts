/**
 * Pure helpers for the OpenAI Realtime API event protocol: parsing server
 * events and building client events. No DOM, no Electron — unit-testable.
 */

export interface RealtimeFunctionCall {
  callId: string;
  name: string;
  /** Raw JSON string of arguments, as produced by the model. */
  arguments: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** Type of a server event, or "" when the payload is not an event. */
export function eventType(event: unknown): string {
  const record = asRecord(event);
  return typeof record?.type === "string" ? record.type : "";
}

/** Extract completed function calls from a `response.done` server event. */
export function extractFunctionCalls(event: unknown): RealtimeFunctionCall[] {
  const response = asRecord(asRecord(event)?.response);
  const output = Array.isArray(response?.output) ? response.output : [];
  const calls: RealtimeFunctionCall[] = [];
  for (const item of output) {
    const record = asRecord(item);
    if (record?.type !== "function_call" || typeof record.name !== "string") continue;
    calls.push({
      callId: typeof record.call_id === "string" ? record.call_id : "",
      name: record.name,
      arguments: typeof record.arguments === "string" ? record.arguments : "{}",
    });
  }
  return calls;
}

/** Delta text from `response.output_audio_transcript.delta`. */
export function transcriptDelta(event: unknown): string {
  const record = asRecord(event);
  return typeof record?.delta === "string" ? record.delta : "";
}

/** User transcript from `conversation.item.input_audio_transcription.completed`. */
export function userTranscript(event: unknown): string {
  const record = asRecord(event);
  return typeof record?.transcript === "string" ? record.transcript.trim() : "";
}

/** Human-readable message from an `error` server event. */
export function errorMessage(event: unknown): string {
  const error = asRecord(asRecord(event)?.error);
  return typeof error?.message === "string" ? error.message : "Realtime session error.";
}

/** Client event: report a tool result back to the session. */
export function functionCallOutputEvent(callId: string, output: string): object {
  return {
    type: "conversation.item.create",
    item: { type: "function_call_output", call_id: callId, output },
  };
}

/** Client event: a typed user message. */
export function userTextEvent(text: string): object {
  return {
    type: "conversation.item.create",
    item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  };
}

/** Client event: ask the model to respond now. */
export function responseCreateEvent(): object {
  return { type: "response.create" };
}
