import { getProviderOrThrow, type ProviderDef } from "@/core/providers";
import { getApiKeys, resolveBaseUrl, type Settings } from "@/core/settings";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OpenAiProvider } from "./openai";
import type { Provider } from "./types";

export interface ResolvedProvider {
  def: ProviderDef;
  provider: Provider;
  model: string;
  baseUrl: string;
  hasKey: boolean;
}

/** Build a provider adapter for the currently selected settings. */
export function createProvider(settings: Settings): ResolvedProvider {
  const def = getProviderOrThrow(settings.provider);
  const apiKeys = getApiKeys(settings, def.id);
  const apiKey = apiKeys[0];
  const baseUrl = resolveBaseUrl(settings, def.id);

  let provider: Provider;

  switch (def.kind) {
    case "anthropic":
      provider = new AnthropicProvider({ baseUrl, apiKey, apiKeys });
      break;
    case "gemini":
      provider = new GeminiProvider({ baseUrl, apiKey, apiKeys });
      break;
    default:
      provider = new OpenAiProvider({
        id: def.id,
        baseUrl,
        apiKey,
        apiKeys,
        requiresKey: def.needsKey ? true : undefined,
        sendReasoningParam: def.id === "openrouter",
        sendReasoningEffort: def.id === "openai",
        headers:
          def.id === "openrouter"
            ? {
                "HTTP-Referer": process.env.SITE_URL || "https://github.com/hiraxcode",
                "X-Title": process.env.SITE_NAME || "HiraxCode",
              }
            : undefined,
      });
  }

  return {
    def,
    provider,
    model: settings.model,
    baseUrl,
    hasKey: Boolean(apiKey) || !def.needsKey,
  };
}

export { OpenAiProvider } from "./openai";
export { AnthropicProvider } from "./anthropic";
export { GeminiProvider } from "./gemini";
export type { Provider, StreamEvent, StreamRequest } from "./types";
export { fetchModels } from "./models";
export { ensureLlamaServer, stopLlamaServer, findLlamaBin } from "./llama";
export { ensureOllamaRunning } from "./ollama";
export { ensureLmStudioRunning } from "./lmstudio";
