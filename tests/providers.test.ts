import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as anthropic from "../src/agent/providers/anthropic";
import { normalizeBaseUrl } from "../src/agent/providers/http";
import * as ollama from "../src/agent/providers/ollama";
import * as openai from "../src/agent/providers/openai";
import type { ProviderHttpConfig } from "../src/agent/providers/config";
import type { Msg, ToolSpec } from "../src/agent/types";

const cfg: ProviderHttpConfig = {
  baseUrl: "",
  apiKey: "sk-test",
  model: "test-model",
  organization: "",
  extraHeaders: {},
};

const tools: ToolSpec[] = [
  {
    name: "datetime",
    description: "Current time.",
    parameters: { type: "object", properties: {} },
  },
];

const conversation: Msg[] = [
  { role: "system", content: "Be brief." },
  { role: "user", content: "What time is it?" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call_1", name: "datetime", arguments: "{}" }],
  },
  { role: "tool", toolCallId: "call_1", name: "datetime", content: "12:00" },
];

describe("base URL normalization", () => {
  it("uses the fallback when blank", () => {
    assert.equal(normalizeBaseUrl("", "https://api.openai.com"), "https://api.openai.com");
  });
  it("strips trailing slashes and /v1", () => {
    assert.equal(normalizeBaseUrl("https://api.groq.com/openai/v1", "x"), "https://api.groq.com/openai");
    assert.equal(normalizeBaseUrl("https://api.openai.com/", "x"), "https://api.openai.com");
  });
  it("adds a scheme for bare hosts", () => {
    assert.equal(normalizeBaseUrl("127.0.0.1:11434", "x"), "http://127.0.0.1:11434");
  });
});

describe("openai request construction", () => {
  const req = openai.buildChatRequest(cfg, conversation, tools);
  const body = JSON.parse(req.body);

  it("targets /v1/chat/completions with bearer auth and streaming", () => {
    assert.equal(req.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(req.headers["authorization"], "Bearer sk-test");
    assert.equal(body.stream, true);
    assert.equal(body.model, "test-model");
  });

  it("maps tool calls and tool results", () => {
    assert.deepEqual(body.messages[2].tool_calls, [
      { id: "call_1", type: "function", function: { name: "datetime", arguments: "{}" } },
    ]);
    assert.deepEqual(body.messages[3], {
      role: "tool",
      tool_call_id: "call_1",
      content: "12:00",
    });
  });

  it("declares tools in function format", () => {
    assert.equal(body.tools[0].type, "function");
    assert.equal(body.tools[0].function.name, "datetime");
  });

  it("sends the organization header when set", () => {
    const req2 = openai.buildChatRequest({ ...cfg, organization: "org-1" }, [], []);
    assert.equal(req2.headers["OpenAI-Organization"], "org-1");
  });

  it("accumulates streamed tool-call fragments", () => {
    const acc = new openai.ToolCallAccumulator();
    acc.add({ index: 0, id: "call_9", function: { name: "date" } });
    acc.add({ index: 0, function: { name: "time" } });
    acc.add({ index: 0, function: { arguments: '{"a":' } });
    acc.add({ index: 0, function: { arguments: "1}" } });
    assert.deepEqual(acc.finish(), [
      { id: "call_9", name: "datetime", arguments: '{"a":1}' },
    ]);
  });
});

describe("anthropic request construction", () => {
  const req = anthropic.buildChatRequest(cfg, conversation, tools);
  const body = JSON.parse(req.body);

  it("targets /v1/messages with x-api-key and version header", () => {
    assert.equal(req.url, "https://api.anthropic.com/v1/messages");
    assert.equal(req.headers["x-api-key"], "sk-test");
    assert.equal(req.headers["anthropic-version"], "2023-06-01");
    assert.equal(body.stream, true);
    assert.ok(body.max_tokens > 0);
  });

  it("lifts system messages out of the message list", () => {
    assert.equal(body.system, "Be brief.");
    assert.ok(body.messages.every((m: { role: string }) => m.role !== "system"));
  });

  it("maps tool use and groups tool results into a user turn", () => {
    assert.deepEqual(body.messages[1].content, [
      { type: "tool_use", id: "call_1", name: "datetime", input: {} },
    ]);
    assert.deepEqual(body.messages[2], {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_1", content: "12:00" }],
    });
  });

  it("declares tools with input_schema", () => {
    assert.equal(body.tools[0].name, "datetime");
    assert.ok(body.tools[0].input_schema);
  });
});

describe("ollama request construction", () => {
  const req = ollama.buildChatRequest(
    { ...cfg, baseUrl: "http://127.0.0.1:11434", apiKey: "" },
    conversation,
    tools
  );
  const body = JSON.parse(req.body);

  it("targets /api/chat with streaming", () => {
    assert.equal(req.url, "http://127.0.0.1:11434/api/chat");
    assert.equal(body.stream, true);
    assert.equal(body.model, "test-model");
  });

  it("maps tool calls with parsed arguments and tool results", () => {
    assert.deepEqual(body.messages[2].tool_calls, [
      { function: { name: "datetime", arguments: {} } },
    ]);
    assert.deepEqual(body.messages[3], {
      role: "tool",
      tool_name: "datetime",
      content: "12:00",
    });
  });
});
