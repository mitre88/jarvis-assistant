/** Internal, provider-agnostic message and streaming types for the agent loop. */

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string of arguments as produced by the model. */
  arguments: string;
}

export type Msg =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool-calls"; calls: ToolCall[] };

export interface ChatProvider {
  /** Stream one model turn. Yields text deltas and, possibly, tool calls. */
  chat(
    messages: Msg[],
    tools: ToolSpec[],
    signal: AbortSignal
  ): AsyncIterable<StreamEvent>;
}
