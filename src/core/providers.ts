import { z } from "zod";
import {
  CATALOG_ALIASES,
  catalogBaseUrl,
  catalogModel as catalogModelEntry,
  catalogModels,
  catalogProvider,
  catalogProviderList,
  isLocalUrl,
  type CatalogModel,
} from "./catalog";

/** All supported provider adapters. */
export type ProviderKind = "openai" | "anthropic" | "gemini";

export interface ProviderDef {
  id: string;
  name: string;
  /** Wire protocol used to talk to the API. */
  kind: ProviderKind;
  baseUrl: string;
  /** Environment variable that can supply the API key. */
  envKey?: string;
  /** Ordered environment variables that can supply the API key. */
  envKeys?: string[];
  /** Whether an API key is required. */
  needsKey: boolean;
  /** Local server (no key, spun up or already running on the machine). */
  local?: boolean;
  /** Spawns a llama.cpp server for a local .gguf file. */
  gguf?: boolean;
  /** Suggested models (used as fallback when listing models fails). */
  models: string[];
  docs?: string;
  /** Where this definition came from. */
  source?: "builtin" | "catalog" | "custom";
  /** Total models known from the catalog. */
  modelCount?: number;
}

/**
 * Curated providers: the ones we know precisely (base URL, key, docs). Any
 * provider in the models.dev catalog that isn't listed here is added
 * automatically at runtime, so HiraxCode supports 200+ providers.
 */
export const PROVIDERS: ProviderDef[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    needsKey: true,
    docs: "https://openrouter.ai/keys",
    source: "builtin",
    models: [
      "openrouter/auto",
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-4.1",
      "google/gemini-2.5-pro",
      "deepseek/deepseek-chat-v3.1",
      "moonshotai/kimi-k2",
      "qwen/qwen3-coder",
      "x-ai/grok-4",
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    needsKey: true,
    docs: "https://platform.openai.com/api-keys",
    source: "builtin",
    models: ["gpt-4.1", "gpt-4.1-mini", "gpt-5", "o4-mini", "gpt-4o"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    envKey: "ANTHROPIC_API_KEY",
    needsKey: true,
    docs: "https://console.anthropic.com/settings/keys",
    source: "builtin",
    models: [
      "claude-sonnet-4-5",
      "claude-opus-4-1",
      "claude-haiku-4-5",
      "claude-3-7-sonnet-latest",
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    envKey: "GEMINI_API_KEY",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
    needsKey: true,
    docs: "https://aistudio.google.com/apikey",
    source: "builtin",
    models: [
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-flash-latest",
      "gemini-pro-latest",
    ],
  },
  {
    id: "groq",
    name: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    needsKey: true,
    docs: "https://console.groq.com/keys",
    source: "builtin",
    models: ["llama-3.3-70b-versatile", "moonshotai/kimi-k2-instruct", "qwen/qwen3-32b"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
    needsKey: true,
    docs: "https://platform.deepseek.com/api_keys",
    source: "builtin",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "mistral",
    name: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
    needsKey: true,
    docs: "https://console.mistral.ai/api-keys",
    source: "builtin",
    models: ["mistral-large-latest", "devstral-medium-latest", "codestral-latest"],
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    envKey: "XAI_API_KEY",
    needsKey: true,
    docs: "https://console.x.ai",
    source: "builtin",
    models: ["grok-4", "grok-3", "grok-code-fast-1"],
  },
  {
    id: "together",
    name: "Together AI",
    kind: "openai",
    baseUrl: "https://api.together.xyz/v1",
    envKey: "TOGETHER_API_KEY",
    needsKey: true,
    docs: "https://api.together.ai/settings/api-keys",
    source: "builtin",
    models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8"],
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    kind: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    envKey: "FIREWORKS_API_KEY",
    needsKey: true,
    docs: "https://fireworks.ai/account/api-keys",
    source: "builtin",
    models: [
      "accounts/fireworks/models/deepseek-v3",
      "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct",
    ],
  },
  {
    id: "cerebras",
    name: "Cerebras",
    kind: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    envKey: "CEREBRAS_API_KEY",
    needsKey: true,
    docs: "https://cloud.cerebras.ai",
    source: "builtin",
    models: ["llama-3.3-70b", "qwen-3-coder-480b"],
  },
  {
    id: "river",
    name: "River AI",
    kind: "openai",
    baseUrl: "https://api.river.ai/v1",
    envKey: "RIVER_API_KEY",
    needsKey: true,
    docs: "https://river.ai",
    source: "builtin",
    models: ["auto", "deepseek-ai/DeepSeek-V4.1-Flash"],
  },
  {
    id: "freellmapi",
    name: "FreeLLMAPI (local router)",
    kind: "openai",
    baseUrl: "http://localhost:3001/v1",
    envKey: "FREELLMAPI_API_KEY",
    envKeys: ["FREELLMAPI_API_KEY", "FREELLMAPI_KEY"],
    needsKey: true,
    local: true,
    docs: "Run FreeLLMAPI, then paste the unified freellmapi-… key (https://github.com/tashfeenahmed/freellmapi)",
    source: "builtin",
    models: ["auto", "auto:fast", "auto:smart", "fusion"],
  },
  {
    id: "ollama",
    name: "Ollama (local, auto)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    needsKey: false,
    local: true,
    source: "builtin",
    models: [],
  },
  {
    id: "lmstudio",
    name: "LM Studio (local, auto)",
    kind: "openai",
    baseUrl: "http://localhost:1234/v1",
    needsKey: false,
    local: true,
    source: "builtin",
    models: [],
  },
  {
    id: "llamacpp",
    name: "llama.cpp (local, auto)",
    kind: "openai",
    baseUrl: "http://localhost:8080/v1",
    needsKey: false,
    local: true,
    source: "builtin",
    models: [],
  },
  {
    id: "gguf",
    name: "GGUF (local file, auto-spawn)",
    kind: "openai",
    baseUrl: "http://127.0.0.1:8181/v1",
    needsKey: false,
    local: true,
    gguf: true,
    source: "builtin",
    docs: "Auto-spawns llama-server (or downloads it). Just pick your .gguf file.",
    models: [],
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "http://localhost:8000/v1",
    needsKey: false,
    source: "builtin",
    docs: "Any OpenAI-compatible endpoint. Set the base URL in settings.",
    models: [],
  },
];

/** User-defined providers, registered from settings at startup. */
let customProviders: ProviderDef[] = [];

export function registerCustomProviders(defs: ProviderDef[]): void {
  customProviders = defs.map((d) => ({ ...d, source: "custom" as const, local: isLocalUrl(d.baseUrl) }));
}

export function customProviderDefs(): ProviderDef[] {
  return customProviders;
}

/** Build a ProviderDef from a models.dev catalog entry. */
function fromCatalog(providerId: string): ProviderDef | undefined {
  const p = catalogProvider(providerId);
  if (!p) return undefined;
  const baseUrl = catalogBaseUrl(p);
  const local = baseUrl ? isLocalUrl(baseUrl) : false;
  const envKeys = p.env ?? [];
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    baseUrl,
    envKey: envKeys[0],
    envKeys,
    needsKey: !local && envKeys.length > 0,
    local,
    models: catalogModels(p.id).slice(0, 60).map((m) => m.id),
    docs: p.doc,
    source: "catalog",
    modelCount: Object.keys(p.models).length,
  };
}

export function getProvider(id: string): ProviderDef | undefined {
  return (
    PROVIDERS.find((p) => p.id === id) ??
    customProviders.find((p) => p.id === id) ??
    fromCatalog(id)
  );
}

export function getProviderOrThrow(id: string): ProviderDef {
  const p = getProvider(id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

/** Every provider: curated + user-defined + the full models.dev catalog. */
export function allProviders(): ProviderDef[] {
  const byId = new Map<string, ProviderDef>();
  for (const p of PROVIDERS) byId.set(p.id, p);
  for (const p of customProviders) byId.set(p.id, p);

  const aliasTargets = new Set(Object.values(CATALOG_ALIASES));
  for (const cp of catalogProviderList()) {
    if (byId.has(cp.id)) continue; // curated/custom wins
    if (aliasTargets.has(cp.id)) continue; // reached through its alias instead
    const def = fromCatalog(cp.id);
    if (def) byId.set(def.id, def);
  }

  return [...byId.values()];
}

/** Group providers for display: local first (they need no key), then cloud. */
export function providerGroups(): { title: string; providers: ProviderDef[] }[] {
  const all = allProviders();
  const byName = (a: ProviderDef, b: ProviderDef) => a.name.localeCompare(b.name);
  return [
    {
      title: "Local",
      providers: all.filter((p) => p.local).sort(byName),
    },
    {
      title: "Cloud",
      providers: all.filter((p) => !p.local).sort(byName),
    },
  ];
}

/** Model ids for a provider: catalog when known, else its curated defaults. */
export function modelsForProvider(providerId: string): string[] {
  const fromCat = catalogModels(providerId).map((m) => m.id);
  if (fromCat.length > 0) return fromCat;
  return getProvider(providerId)?.models ?? [];
}

/** Catalog capability record for a model (undefined for local/unknown models). */
export function modelInfo(providerId: string, modelId: string): CatalogModel | undefined {
  return catalogModelEntry(providerId, modelId);
}

/** Whether a model accepts the `temperature` parameter (default: yes). */
export function modelSupportsTemperature(providerId: string, modelId: string): boolean {
  return modelInfo(providerId, modelId)?.temperature ?? true;
}

/** Whether a model supports tool calling (default: yes). */
export function modelSupportsToolCalls(providerId: string, modelId: string): boolean {
  return modelInfo(providerId, modelId)?.tool_call ?? true;
}

/** A compact capability line for the model picker, e.g. "vision · tools · 128k · $3/$15". */
export function modelHint(providerId: string, modelId: string): string {
  const info = modelInfo(providerId, modelId);
  if (!info) return "";
  const bits: string[] = [];
  if (info.attachment) bits.push("vision");
  if (info.tool_call) bits.push("tools");
  if (info.reasoning) bits.push("reasoning");
  const ctx = info.limit?.context;
  if (ctx && ctx > 0) bits.push(ctx >= 1000 ? `${Math.round(ctx / 1000)}k ctx` : `${ctx} ctx`);
  const c = info.cost;
  if (c && (c.input || c.output)) bits.push(`$${fmt(c.input)}/$${fmt(c.output)}`);
  return bits.join(" · ");
}

function fmt(n: number | undefined): string {
  if (n === undefined) return "0";
  return n >= 10 ? String(Math.round(n)) : String(n);
}

export const ProviderIdSchema = z.string().min(1);
