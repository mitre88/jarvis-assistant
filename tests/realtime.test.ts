import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRealtimeSessionPayload, REALTIME_MODEL } from "../src/agent/realtime";
import {
  errorMessage,
  eventType,
  extractFunctionCalls,
  functionCallOutputEvent,
  responseCreateEvent,
  transcriptDelta,
  userTranscript,
  userTextEvent,
} from "../src/shared/realtime-events";

describe("realtime event parsing", () => {
  it("reads the event type defensively", () => {
    assert.equal(eventType({ type: "response.done" }), "response.done");
    assert.equal(eventType(null), "");
    assert.equal(eventType("garbage"), "");
    assert.equal(eventType({ type: 42 }), "");
  });

  it("extracts function calls from response.done", () => {
    const event = {
      type: "response.done",
      response: {
        output: [
          { type: "message", role: "assistant" },
          { type: "function_call", call_id: "c1", name: "get_time", arguments: "{}" },
          { type: "function_call", call_id: "c2", name: "read_file", arguments: '{"path":"a.txt"}' },
          { type: "function_call" }, // malformed: no name
        ],
      },
    };
    const calls = extractFunctionCalls(event);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { callId: "c1", name: "get_time", arguments: "{}" });
    assert.equal(calls[1]!.name, "read_file");
  });

  it("returns no calls for unrelated or malformed events", () => {
    assert.deepEqual(extractFunctionCalls({ type: "response.done" }), []);
    assert.deepEqual(extractFunctionCalls(undefined), []);
  });

  it("reads transcript deltas and user transcripts", () => {
    assert.equal(transcriptDelta({ delta: "Hello" }), "Hello");
    assert.equal(transcriptDelta({}), "");
    assert.equal(userTranscript({ transcript: " turn on the lights \n" }), "turn on the lights");
    assert.equal(userTranscript({}), "");
  });

  it("formats error events with a fallback", () => {
    assert.equal(errorMessage({ error: { message: "rate limited" } }), "rate limited");
    assert.equal(errorMessage({}), "Realtime session error.");
  });
});

describe("realtime client events", () => {
  it("builds a function_call_output item", () => {
    assert.deepEqual(functionCallOutputEvent("c1", "42"), {
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: "c1", output: "42" },
    });
  });

  it("builds a user text message and a response request", () => {
    const text = userTextEvent("status report") as {
      type: string;
      item: { content: { text: string }[] };
    };
    assert.equal(text.type, "conversation.item.create");
    assert.equal(text.item.content[0]!.text, "status report");
    assert.deepEqual(responseCreateEvent(), { type: "response.create" });
  });
});

describe("realtime session payload", () => {
  it("maps voice, instructions, and the tool registry", () => {
    const payload = buildRealtimeSessionPayload({
      voice: "marin",
      instructions: "You are Jarvis.",
      tools: [
        {
          name: "get_time",
          description: "Current time",
          parameters: { type: "object", properties: {} },
        },
      ],
    }) as {
      session: {
        type: string;
        model: string;
        instructions: string;
        audio: { output: { voice: string } };
        tools: { type: string; name: string }[];
      };
    };
    assert.equal(payload.session.type, "realtime");
    assert.equal(payload.session.model, REALTIME_MODEL);
    assert.equal(payload.session.instructions, "You are Jarvis.");
    assert.equal(payload.session.audio.output.voice, "marin");
    assert.equal(payload.session.tools.length, 1);
    assert.deepEqual(payload.session.tools[0], {
      type: "function",
      name: "get_time",
      description: "Current time",
      parameters: { type: "object", properties: {} },
    });
  });
});
