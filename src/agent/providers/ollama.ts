/** Ollama native chat API (NDJSON streaming, tool calling). */
import type { ChatProvider, Msg, StreamEvent, ToolCall, ToolSpec } from "../types";
import type { ProviderHttpConfig } from "./config";
import { FetchLike, ndjson, normalizeBaseUrl, readErrorBody } from "./http";

const DEFAULT_BASE = "http://127.0.0.1:11434";

function parseArgs(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function messagesToOllama(messages: Msg[]): unknown[] {
  return messages.map((m) => {
    switch (m.role) {
      case "system":
      case "user":
        return { role: m.role, content: m.content };
      case "assistant": {
        const out: Record<string, unknown> = { role: "assistant", content: m.content };
        if (m.toolCalls && m.toolCalls.length > 0) {
          out["tool_calls"] = m.toolCalls.map((c) => ({
            function: { name: c.name, arguments: parseArgs(c.arguments) },
          }));
        }
        return out;
      }
      case "tool":
        return { role: "tool", tool_name: m.name, content: m.content };
    }
  });
}

export function buildChatRequest(
  cfg: ProviderHttpConfig,
  messages: Msg[],
  tools: ToolSpec[]
): { url: string; headers: Record<string, string>; body: string } {
  const base = normalizeBaseUrl(cfg.baseUrl, DEFAULT_BASE);
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: messagesToOllama(messages),
    stream: true,
  };
  if (tools.length > 0) {
    body["tools"] = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  return {
    url: `${base}/api/chat`,
    headers: { "content-type": "application/json", ...cfg.extraHeaders },
    body: JSON.stringify(body),
  };
}

interface OllamaChunk {
  message?: {
    content?: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  };
  done?: boolean;
  error?: string;
}

export class OllamaProvider implements ChatProvider {
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
      throw new Error(`Ollama returned ${res.status}: ${await readErrorBody(res)}`);
    }
    const calls: ToolCall[] = [];
    for await (const raw of ndjson(res)) {
      const chunk = raw as OllamaChunk;
      if (chunk.error) throw new Error(chunk.error);
      if (chunk.message?.content) yield { type: "text", text: chunk.message.content };
      for (const tc of chunk.message?.tool_calls ?? []) {
        calls.push({
          id: `call_${calls.length}`,
          name: tc.function.name,
          arguments: JSON.stringify(tc.function.arguments ?? {}),
        });
      }
    }
    if (calls.length > 0) yield { type: "tool-calls", calls };
  }
}

export async function testOllama(
  cfg: ProviderHttpConfig,
  fetchImpl: FetchLike = fetch
): Promise<{ ok: boolean; detail: string; models?: string[] }> {
  const base = normalizeBaseUrl(cfg.baseUrl, DEFAULT_BASE);
  const res = await fetchImpl(`${base}/api/tags`, {
    method: "GET",
    headers: { ...cfg.extraHeaders },
  });
  if (!res.ok) {
    return { ok: false, detail: `HTTP ${res.status}: ${await readErrorBody(res)}` };
  }
  const data = (await res.json()) as { models?: { name: string }[] };
  const models = (data.models ?? []).map((m) => m.name);
  const found = cfg.model && models.some((n) => n === cfg.model || n === `${cfg.model}:latest`);
  if (found) {
    return { ok: true, detail: `Connected. Model "${cfg.model}" is installed.`, models };
  }
  const note = cfg.model
    ? ` Model "${cfg.model}" not installed — run \`ollama pull ${cfg.model}\`.`
    : "";
  return { ok: true, detail: `Connected. ${models.length} models installed.${note}`, models };
}
