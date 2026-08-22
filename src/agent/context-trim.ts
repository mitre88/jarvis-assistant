/**
 * Keep the wire payload to the model bounded: last N user-turns plus
 * truncated tool results. The in-memory conversation is left intact.
 */
import type { Msg } from "./types";

export const DEFAULT_MAX_TURNS = 16;
export const TOOL_RESULT_CHAR_CAP = 8 * 1024;

export function truncateToolContent(content: string, cap = TOOL_RESULT_CHAR_CAP): string {
  if (content.length <= cap) return content;
  return `${content.slice(0, cap)}\n… truncated for context (${content.length} chars total)`;
}

/** Number of user messages in a conversation (system excluded). */
export function countTurns(messages: Msg[]): number {
  return messages.filter((m) => m.role === "user").length;
}

/**
 * Return a copy of `messages` suitable for a provider call:
 * every system message, then the last `maxTurns` user turns (and whatever
 * assistant/tool messages follow the first kept user), with oversized tool
 * results clipped so later rounds do not re-send 256 KB file dumps.
 */
export function trimMessages(messages: Msg[], maxTurns = DEFAULT_MAX_TURNS): Msg[] {
  const system: Msg[] = [];
  const rest: Msg[] = [];
  for (const m of messages) {
    if (m.role === "system") system.push(m);
    else rest.push(m);
  }

  const userIdx: number[] = [];
  rest.forEach((m, i) => {
    if (m.role === "user") userIdx.push(i);
  });

  let kept = rest;
  if (userIdx.length > maxTurns) {
    const start = userIdx[userIdx.length - maxTurns]!;
    kept = rest.slice(start);
  }

  return [
    ...system,
    ...kept.map((m) =>
      m.role === "tool" ? { ...m, content: truncateToolContent(m.content) } : m
    ),
  ];
}
