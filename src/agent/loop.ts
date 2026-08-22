/**
 * The agent loop: stream a model turn, execute any requested tools, feed
 * results back, and repeat until the model produces a final reply or the
 * iteration cap is reached.
 */
import { DEFAULT_MAX_TURNS, trimMessages } from "./context-trim";
import type { ChatProvider, Msg, ToolCall, ToolSpec } from "./types";
import type { ToolContext } from "./tools/context";
import type { ToolOutcome, ToolRegistry } from "./tools/registry";

export const DEFAULT_MAX_TOOL_ITERATIONS = 8;
const SUMMARY_CHARS = 160;
const BUDGET_NOTE =
  "Tool budget exhausted. Answer the user now without further tools. Summarise what you already know.";

export type LoopEvent =
  | { type: "token"; text: string }
  | { type: "tool-call"; name: string; summary: string }
  | { type: "tool-result"; name: string; summary: string; isError: boolean };

export interface AgentRunOptions {
  provider: ChatProvider;
  /** Conversation so far, including the system prompt. Extended in place. */
  messages: Msg[];
  registry: ToolRegistry;
  ctx: ToolContext;
  signal: AbortSignal;
  maxToolIterations?: number;
  maxTurns?: number;
  onEvent: (event: LoopEvent) => void;
}

export function summarize(text: string, cap = SUMMARY_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > cap ? `${flat.slice(0, cap)}…` : flat;
}

async function streamTurn(
  opts: AgentRunOptions,
  tools: ToolSpec[]
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  let text = "";
  let toolCalls: ToolCall[] = [];
  const outgoing = trimMessages(opts.messages, opts.maxTurns ?? DEFAULT_MAX_TURNS);

  for await (const event of opts.provider.chat(outgoing, tools, opts.signal)) {
    if (event.type === "text") {
      text += event.text;
      opts.onEvent({ type: "token", text: event.text });
    } else {
      toolCalls = event.calls;
    }
  }
  return { text, toolCalls };
}

function cancelRemaining(calls: ToolCall[], messages: Msg[]): void {
  for (const skipped of calls) {
    messages.push({
      role: "tool",
      toolCallId: skipped.id,
      name: skipped.name,
      content: "Cancelled by the user.",
    });
  }
}

async function executeCalls(opts: AgentRunOptions, calls: ToolCall[]): Promise<void> {
  const ctx: ToolContext = { ...opts.ctx, signal: opts.signal };
  const parallel = calls.length > 1 && calls.every((c) => opts.registry.isReadOnly(c.name));

  if (parallel) {
    if (opts.signal.aborted) {
      cancelRemaining(calls, opts.messages);
      throw new Error("Cancelled");
    }
    for (const call of calls) {
      opts.onEvent({ type: "tool-call", name: call.name, summary: summarize(call.arguments) });
    }
    const outcomes: ToolOutcome[] = await Promise.all(
      calls.map((call) => opts.registry.execute(call.name, call.arguments, ctx))
    );
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]!;
      const outcome = outcomes[i]!;
      opts.onEvent({
        type: "tool-result",
        name: call.name,
        summary: summarize(outcome.content),
        isError: outcome.isError,
      });
      opts.messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: outcome.content,
      });
    }
    return;
  }

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i]!;
    if (opts.signal.aborted) {
      cancelRemaining(calls.slice(i), opts.messages);
      throw new Error("Cancelled");
    }
    opts.onEvent({ type: "tool-call", name: call.name, summary: summarize(call.arguments) });
    const outcome = await opts.registry.execute(call.name, call.arguments, ctx);
    opts.onEvent({
      type: "tool-result",
      name: call.name,
      summary: summarize(outcome.content),
      isError: outcome.isError,
    });
    opts.messages.push({
      role: "tool",
      toolCallId: call.id,
      name: call.name,
      content: outcome.content,
    });
  }
}

export async function runAgent(opts: AgentRunOptions): Promise<string> {
  const max = opts.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const specs = opts.registry.specs();

  for (let iteration = 0; ; iteration++) {
    const { text, toolCalls } = await streamTurn(opts, specs);

    opts.messages.push({
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });

    if (toolCalls.length === 0) return text;

    if (iteration >= max) {
      for (const call of toolCalls) {
        opts.messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: BUDGET_NOTE,
        });
      }
      const last = await streamTurn(opts, []);
      opts.messages.push({ role: "assistant", content: last.text });
      if (last.text.trim()) return last.text;
      const capped = `Tool iteration limit (${max}) reached; stopping here.`;
      return text ? `${text}\n\n${capped}` : capped;
    }

    await executeCalls(opts, toolCalls);
  }
}
