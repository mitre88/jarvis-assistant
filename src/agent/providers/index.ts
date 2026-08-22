import type { ProviderKind, TestConnectionResult } from "../../shared/types";
import type { ChatProvider } from "../types";
import type { ProviderHttpConfig } from "./config";
import type { FetchLike } from "./http";
import { withRetries } from "./http";
import { AnthropicProvider, testAnthropic } from "./anthropic";
import { OllamaProvider, testOllama } from "./ollama";
import { OpenAIProvider, testOpenAI } from "./openai";

export { PROVIDER_DEFAULTS } from "./config";
export type { ProviderHttpConfig } from "./config";

export function createProvider(
  kind: ProviderKind,
  cfg: ProviderHttpConfig,
  fetchImpl: FetchLike = fetch
): ChatProvider {
  const resilient = withRetries(fetchImpl);
  switch (kind) {
    case "anthropic":
      return new AnthropicProvider(cfg, resilient);
    case "ollama":
      return new OllamaProvider(cfg, resilient);
    case "openai":
    case "lmstudio":
      // LM Studio serves the OpenAI-compatible protocol on localhost.
      return new OpenAIProvider(cfg, resilient);
  }
}

export async function testConnection(
  kind: ProviderKind,
  cfg: ProviderHttpConfig,
  fetchImpl: FetchLike = fetch
): Promise<TestConnectionResult> {
  try {
    switch (kind) {
      case "anthropic":
        return await testAnthropic(cfg, fetchImpl);
      case "ollama":
        return await testOllama(cfg, fetchImpl);
      case "openai":
      case "lmstudio":
        return await testOpenAI(cfg, fetchImpl);
    }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
