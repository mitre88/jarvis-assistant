/** Anthropic Messages API (SSE streaming, tool use). */
import type { ChatProvider, Msg, StreamEvent, ToolCall, ToolSpec } from "../types";
import type { ProviderHttpConfig } from "./config";
import { FetchLike, normalizeBaseUrl, readErrorBody, sseData } from "./http";

const DEFAULT_BASE = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";
const MAX_TOKENS = 4096;

export function anthropicHeaders(cfg: ProviderHttpConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    "anthropic-version": API_VERSION,
    ...(cfg.apiKey ? { "x-api-key": cfg.apiKey } : {}),
    ...cfg.extraHeaders,
  };
}

function parseArgs(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Map internal messages to Anthropic format. System messages become the
 * top-level `system` string; consecutive tool results are grouped into a
 * single user message, as the API requires.
 */
export function messagesToAnthropic(messages: Msg[]): {
  system: string;
  messages: unknown[];
} {
  const system: string[] = [];
  const out: unknown[] = [];
  let pendingToolResults: unknown[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      out.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const m of messages) {
    if (m.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
      });
      continue;
    }
    flushToolResults();
    switch (m.role) {
      case "system":
        system.push(m.content);
        break;
      case "user":
        out.push({ role: "user", content: m.content });
        break;
      case "assistant": {
        const blocks: unknown[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const c of m.toolCalls ?? []) {
          blocks.push({
            type: "tool_use",
            id: c.id,
            name: c.name,
            input: parseArgs(c.arguments),
          });
        }
        out.push({ role: "assistant", content: blocks });
        break;
      }
    }
  }
  flushToolResults();
  return { system: system.join("\n\n"), messages: out };
}

export function toolsToAnthropic(tools: ToolSpec[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export function buildChatRequest(
  cfg: ProviderHttpConfig,
  messages: Msg[],
  tools: ToolSpec[]
): { url: string; headers: Record<string, string>; body: string } {
  const base = normalizeBaseUrl(cfg.baseUrl, DEFAULT_BASE);
  const { system, messages: mapped } = messagesToAnthropic(messages);
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: MAX_TOKENS,
    messages: mapped,
    stream: true,
  };
  if (system) body["system"] = system;
  if (tools.length > 0) body["tools"] = toolsToAnthropic(tools);
  return {
    url: `${base}/v1/messages`,
    headers: anthropicHeaders(cfg),
    body: JSON.stringify(body),
  };
}

interface AnthropicStreamChunk {
  type: string;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string };
  index?: number;
}

export class AnthropicProvider implements ChatProvider {
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
    const calls: ToolCall[] = [];
    let current: { id: string; name: string; json: string } | null = null;
    for await (const payload of sseData(res)) {
      const chunk = JSON.parse(payload) as AnthropicStreamChunk;
      switch (chunk.type) {
        case "content_block_start":
          if (chunk.content_block?.type === "tool_use") {
            current = {
              id: chunk.content_block.id ?? `call_${calls.length}`,
              name: chunk.content_block.name ?? "",
              json: "",
            };
          }
          break;
        case "content_block_delta":
          if (chunk.delta?.type === "text_delta" && chunk.delta.text) {
            yield { type: "text", text: chunk.delta.text };
          } else if (chunk.delta?.type === "input_json_delta" && current) {
            current.json += chunk.delta.partial_json ?? "";
          }
          break;
        case "content_block_stop":
          if (current) {
            calls.push({ id: current.id, name: current.name, arguments: current.json || "{}" });
            current = null;
          }
          break;
        case "error": {
          const err = chunk as unknown as { error?: { message?: string } };
          throw new Error(err.error?.message ?? "Provider stream error");
        }
      }
    }
    if (calls.length > 0) yield { type: "tool-calls", calls };
  }
}

export async function testAnthropic(
  cfg: ProviderHttpConfig,
  fetchImpl: FetchLike = fetch
): Promise<{ ok: boolean; detail: string; models?: string[] }> {
  const base = normalizeBaseUrl(cfg.baseUrl, DEFAULT_BASE);
  const res = await fetchImpl(`${base}/v1/models`, {
    method: "GET",
    headers: anthropicHeaders(cfg),
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
