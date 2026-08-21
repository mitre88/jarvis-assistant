import type { ProviderKind } from "./types";

export const PROVIDER_DEFAULTS: Record<
  ProviderKind,
  { label: string; baseUrl: string; needsKey: boolean }
> = {
  openai: {
    label: "OpenAI-compatible",
    baseUrl: "https://api.openai.com",
    needsKey: true,
  },
  anthropic: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    needsKey: true,
  },
  ollama: {
    label: "Ollama",
    baseUrl: "http://127.0.0.1:11434",
    needsKey: false,
  },
  lmstudio: {
    label: "LM Studio",
    baseUrl: "http://127.0.0.1:1234",
    needsKey: false,
  },
};
