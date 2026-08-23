/**
 * Builds the session payload for POST /v1/realtime/client_secrets. The tools
 * exposed to the Realtime model are the exact same registry the local agent
 * loop uses; execution and approval stay in the main process either way.
 */
import type { ToolSpec } from "./types";

export const REALTIME_MODEL = "gpt-realtime";

export interface RealtimeSessionConfig {
  voice: string;
  instructions: string;
  tools: ToolSpec[];
}

export function buildRealtimeSessionPayload(config: RealtimeSessionConfig): object {
  return {
    session: {
      type: "realtime",
      model: REALTIME_MODEL,
      instructions: config.instructions,
      audio: {
        input: {
          transcription: { model: "gpt-4o-mini-transcribe" },
        },
        output: {
          voice: config.voice,
        },
      },
      tools: config.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
  };
}
