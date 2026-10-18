import { getProvider, type ProviderDef } from "@/core/providers";
import { logger } from "@/utils/logger";

/**
 * Ask a provider for its model list. Tries each key in turn (so a dead first
 * key doesn't block listing). Returns [] when the endpoint doesn't support
 * listing or every request fails.
 */
export async function fetchModels(
  providerId: string,
  baseUrl: string,
  apiKey?: string | string[],
): Promise<string[]> {
  const def = getProvider(providerId);
  if (!def) return [];
  if (def.id === "gguf") return [];

  const keys = (Array.isArray(apiKey) ? apiKey : apiKey ? [apiKey] : [])
    .map((k) => k.trim())
    .filter(Boolean);
  const candidates: (string | undefined)[] = keys.length > 0 ? keys : [undefined];

  for (const key of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      const models = await list(def, baseUrl, key, controller.signal);
      clearTimeout(timer);
      if (models.length > 0) return models;
    } catch (e) {
      logger.debug("fetchModels failed", providerId, (e as Error).message);
    }
  }
  return [];
}

async function list(
  def: ProviderDef,
  baseUrl: string,
  apiKey: string | undefined,
  signal: AbortSignal,
): Promise<string[]> {
  if (def.kind === "anthropic") {
    const res = await fetch(`${baseUrl}/v1/models?limit=100`, {
      headers: { "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01" },
      signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => m.id);
  }

  if (def.kind === "gemini") {
    const res = await fetch(
      `${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey ?? "")}`,
      { signal },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { models?: { name: string }[] };
    return (json.models ?? [])
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /^gemini/i.test(n))
      .filter(
        (n) => !/(tts|image|computer-use|robotics|lyria|nano-banana|transcribe)/i.test(n),
      );
  }

  // OpenAI-compatible
  const res = await fetch(`${baseUrl}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal,
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: { id: string }[] };
  const models = (json.data ?? []).map((m) => m.id);
  return models.filter((m) => !/(embedding|whisper|audio|tts|vision-classifier)/i.test(m));
}
