/**
 * OpenAI-compatible chat completions protocol (SSE streaming, tool calling).
 * Covers OpenAI, Groq, Together, LM Studio, and any /v1/chat/completions API.
 */
import type { ChatProvider, Msg, StreamEvent, ToolCall, ToolSpec } from "../types";
import type { ProviderHttpConfig } from "./config";
import { FetchLike, normalizeBaseUrl, readErrorBody, sseData } from "./http";

const DEFAULT_BASE = "https://api.openai.com";

export function openAiHeaders(cfg: ProviderHttpConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...cfg.extraHeaders,
  };
  if (cfg.apiKey) headers["authorization"] = `Bearer ${cfg.apiKey}`;
  if (cfg.organization) headers["OpenAI-Organization"] = cfg.organization;
  return headers;
}

export function messagesToOpenAI(messages: Msg[]): unknown[] {
  return messages.map((m) => {
    switch (m.role) {
      case "system":
      case "user":
        return { role: m.role, content: m.content };
      case "assistant": {
        const out: Record<string, unknown> = { role: "assistant", content: m.content };
        if (m.toolCalls && m.toolCalls.length > 0) {
          out["tool_calls"] = m.toolCalls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: c.arguments },
          }));
        }
        return out;
      }
      case "tool":
        return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    }
  });
}

export function toolsToOpenAI(tools: ToolSpec[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function buildChatRequest(
  cfg: ProviderHttpConfig,
  messages: Msg[],
  tools: ToolSpec[]
): { url: string; headers: Record<string, string>; body: string } {
  const base = normalizeBaseUrl(cfg.baseUrl, DEFAULT_BASE);
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: messagesToOpenAI(messages),
    stream: true,
  };
  if (tools.length > 0) body["tools"] = toolsToOpenAI(tools);
  return {
    url: `${base}/v1/chat/completions`,
    headers: openAiHeaders(cfg),
    body: JSON.stringify(body),
  };
}

interface ToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** Accumulates streamed tool-call fragments (keyed by index) into ToolCalls. */
export class ToolCallAccumulator {
  private parts = new Map<number, { id: string; name: string; args: string }>();

  add(delta: ToolCallDelta): void {
    let part = this.parts.get(delta.index);
    if (!part) {
      part = { id: "", name: "", args: "" };
      this.parts.set(delta.index, part);
    }
    if (delta.id) part.id = delta.id;
    if (delta.function?.name) part.name += delta.function.name;
    if (delta.function?.arguments) part.args += delta.function.arguments;
  }

  finish(): ToolCall[] {
    return [...this.parts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([i, p]) => ({
        id: p.id || `call_${i}`,
        name: p.name,
        arguments: p.args || "{}",
      }));
  }

  get size(): number {
    return this.parts.size;
  }
}

export class OpenAIProvider implements ChatProvider {
  constructor(
    private cfg: ProviderHttpConfig,
    private fetchImpl: FetchLike = fetch
  ) {}

  async *chat(
    messages: Msg[],
    tools: ToolSpec[],
    signal: AbortSignal
  ): AsyncGenerator<StreamEvent> {
    const req = buildChatRequest(this.cfg, messages, tools);
    const res = await this.fetchImpl(req.url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      signal,
    });
    if (!res.ok) {
      throw new Error(`Provider returned ${res.status}: ${await readErrorBody(res)}`);
    }
    const acc = new ToolCallAccumulator();
    for await (const payload of sseData(res)) {
      const chunk = JSON.parse(payload) as {
        choices?: { delta?: { content?: string | null; tool_calls?: ToolCallDelta[] } }[];
      };
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) yield { type: "text", text: delta.content };
      for (const tc of delta.tool_calls ?? []) acc.add(tc);
    }
    if (acc.size > 0) yield { type: "tool-calls", calls: acc.finish() };
  }
}

export async function testOpenAI(
  cfg: ProviderHttpConfig,
  fetchImpl: FetchLike = fetch
): Promise<{ ok: boolean; detail: string; models?: string[] }> {
  const base = normalizeBaseUrl(cfg.baseUrl, DEFAULT_BASE);
  const res = await fetchImpl(`${base}/v1/models`, {
    method: "GET",
    headers: openAiHeaders(cfg),
  });
  if (!res.ok) {
    return { ok: false, detail: `HTTP ${res.status}: ${await readErrorBody(res)}` };
  }
  const data = (await res.json()) as { data?: { id: string }[] };
  const models = (data.data ?? []).map((m) => m.id);
  if (cfg.model && models.includes(cfg.model)) {
    return { ok: true, detail: `Connected. Model "${cfg.model}" is available.`, models };
  }
  const note = cfg.model
    ? ` Model "${cfg.model}" not in the list — it may still work.`
    : "";
  return { ok: true, detail: `Connected. ${models.length} models available.${note}`, models };
}
