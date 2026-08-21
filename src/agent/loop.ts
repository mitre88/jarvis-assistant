/**
 * The agent loop: stream a model turn, execute any requested tools, feed
 * results back, and repeat until the model produces a final reply or the
 * iteration cap is reached.
 */
import type { ChatProvider, Msg, ToolCall } from "./types";
import type { ToolContext } from "./tools/context";
import type { ToolRegistry } from "./tools/registry";

export const DEFAULT_MAX_TOOL_ITERATIONS = 8;
const SUMMARY_CHARS = 160;

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
  onEvent: (event: LoopEvent) => void;
}

export function summarize(text: string, cap = SUMMARY_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > cap ? `${flat.slice(0, cap)}…` : flat;
}

export async function runAgent(opts: AgentRunOptions): Promise<string> {
  const max = opts.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;

  for (let iteration = 0; ; iteration++) {
    let text = "";
    let toolCalls: ToolCall[] = [];

    for await (const event of opts.provider.chat(
      opts.messages,
      opts.registry.specs(),
      opts.signal
    )) {
      if (event.type === "text") {
        text += event.text;
        opts.onEvent({ type: "token", text: event.text });
      } else {
        toolCalls = event.calls;
      }
    }

    opts.messages.push({
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });

    if (toolCalls.length === 0) return text;

    if (iteration >= max) {
      const capped = `Tool iteration limit (${max}) reached; stopping here.`;
      for (const call of toolCalls) {
        opts.messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: capped,
        });
      }
      return text ? `${text}\n\n${capped}` : capped;
    }

    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i]!;
      if (opts.signal.aborted) {
        // Keep the history consistent: every tool call gets a result.
        for (const skipped of toolCalls.slice(i)) {
          opts.messages.push({
            role: "tool",
            toolCallId: skipped.id,
            name: skipped.name,
            content: "Cancelled by the user.",
          });
        }
        throw new Error("Cancelled");
      }
      opts.onEvent({ type: "tool-call", name: call.name, summary: summarize(call.arguments) });
      const outcome = await opts.registry.execute(call.name, call.arguments, opts.ctx);
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
}
