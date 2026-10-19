import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  PROVIDERS,
  allProviders,
  getProvider,
  registerCustomProviders,
  type ProviderDef,
  type ProviderKind,
} from "./providers";
import { logger } from "@/utils/logger";

export interface ReasoningSettings {
  enabled: boolean;
  effort: "low" | "medium" | "high";
}

/** A user-defined provider (any OpenAI-compatible endpoint). */
export interface CustomProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  envKey?: string;
  models?: string[];
}

export interface Settings {
  provider: string;
  model: string;
  /**
   * apiKeys[providerId] = one or more keys, comma-separated. The first is used
   * first; the rest are rotated in when a key is rejected (401/402/403/429).
   */
  apiKeys: Record<string, string>;
  /** per-provider base URL override, keyed by provider id */
  baseUrls: Record<string, string>;
  /** providers added by the user */
  customProviders: CustomProvider[];
  /** path to a .gguf file for the "gguf" provider */
  ggufPath: string;
  /** optional multimodal projector (.mmproj) — enables vision for local GGUF models */
  mmprojPath: string;
  /** llama-server binary (defaults to "llama-server") */
  llamaServerBin: string;
  /** optional extra args for llama-server */
  llamaExtraArgs: string;
  temperature: number;
  maxTokens: number;
  reasoning: ReasoningSettings;
  /** selected agent (build, plan, general, or a custom one) */
  agent: string;
  autoApproveSafeTools: boolean;
  /** Skip the confirmation prompt for every tool, including writes and shell. */
  autoApproveAll: boolean;
  workingDir: string;
  /** UI accent colour (hex) */
  accent: string;
  /** show the sessions sidebar by default */
  showSidebar: boolean;
  /** minimalist UI mode */
  minimal: boolean;
  /** compact transcript density */
  compact: boolean;
  /**
   * Watch the OS clipboard and attach freshly copied screenshots automatically.
   * Only useful (and only active) on Windows, where terminals swallow Ctrl+V.
   * `false` disables it; undefined means "on".
   */
  clipboardWatch?: boolean;
}

export const ACCENTS = [
  // A warm sand tone is the default; the rest cycle via /theme.
  { name: "sand", value: "#fab283" },
  { name: "gold", value: "#ffbf00" },
  { name: "cyan", value: "#22d3ee" },
  { name: "violet", value: "#a78bfa" },
  { name: "emerald", value: "#34d399" },
  { name: "amber", value: "#fbbf24" },
  { name: "rose", value: "#fb7185" },
  { name: "sky", value: "#60a5fa" },
  { name: "orange", value: "#fb923c" },
];

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "hiraxcode");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Build defaults from environment variables (so .env still works). */
export function defaultsFromEnv(): Settings {
  const apiKeys: Record<string, string> = {};
  for (const p of allProviders()) {
    const envKeys = p.envKeys ?? (p.envKey ? [p.envKey] : []);
    for (const envKey of envKeys) {
      const value = process.env[envKey];
      if (value && value.trim()) {
        apiKeys[p.id] = value.trim();
        break;
      }
    }
  }

  // Detect a sensible starting provider: explicit env, else the first one with a key,
  // else OpenRouter.
  const envProvider = process.env.HIRAX_PROVIDER?.trim();
  const provider =
    envProvider ||
    allProviders().find((p) => apiKeys[p.id])?.id ||
    "openrouter";

  const def = getProvider(provider) ?? PROVIDERS[0]!;
  const model = process.env.MODEL?.trim() || def.models[0] || "";

  const baseUrls: Record<string, string> = {};
  if (process.env.BASE_URL?.trim()) {
    baseUrls[def.id] = process.env.BASE_URL.trim();
  }

  return {
    provider,
    model,
    apiKeys,
    baseUrls,
    customProviders: [],
    ggufPath: process.env.GGUF_PATH?.trim() || "",
    mmprojPath: process.env.MMPROJ_PATH?.trim() || "",
    llamaServerBin: process.env.LLAMA_SERVER_BIN?.trim() || "llama-server",
    llamaExtraArgs: process.env.LLAMA_EXTRA_ARGS?.trim() || "",
    temperature: clampTemperature(envNum("TEMPERATURE", 0.2)),
    maxTokens: envNum("MAX_TOKENS", 0),
    reasoning: {
      enabled: envBool("ENABLE_REASONING", true),
      effort: (process.env.REASONING_EFFORT as Settings["reasoning"]["effort"]) || "medium",
    },
    agent: process.env.HIRAX_AGENT?.trim() || "build",
    autoApproveSafeTools: envBool("AUTO_APPROVE_SAFE_TOOLS", true),
    autoApproveAll: envBool("AUTO_APPROVE_ALL", false),
    workingDir: process.env.WORKING_DIR?.trim() || process.cwd(),
    accent: process.env.ACCENT?.trim() || ACCENTS[0]!.value,
    showSidebar: envBool("SHOW_SIDEBAR", false),
    minimal: envBool("HIRAX_MINIMAL", false),
    compact: envBool("HIRAX_COMPACT", false),
  };
}

function readConfigFile(): Partial<Settings> {
  try {
    const p = configPath();
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8")) as Partial<Settings>;
  } catch {
    return {};
  }
}

export function loadSettings(): Settings {
  const base = defaultsFromEnv();
  const file = readConfigFile();

  const merged: Settings = {
    ...base,
    ...file,
    apiKeys: { ...base.apiKeys, ...(file.apiKeys ?? {}) },
    baseUrls: { ...base.baseUrls, ...(file.baseUrls ?? {}) },
    customProviders: (file as any).customProviders ?? base.customProviders ?? [],
    reasoning: { ...base.reasoning, ...(file.reasoning ?? {}) },
    mmprojPath: (file as any).mmprojPath ?? base.mmprojPath ?? "",
    llamaExtraArgs: (file as any).llamaExtraArgs ?? base.llamaExtraArgs ?? "",
    agent: (file as any).agent ?? base.agent ?? "build",
    autoApproveAll: (file as any).autoApproveAll ?? base.autoApproveAll ?? false,
    temperature: clampTemperature(file.temperature ?? base.temperature),
    minimal: (file as any).minimal ?? base.minimal ?? false,
    compact: (file as any).compact ?? base.compact ?? false,
  };

  // Make user-defined providers resolvable before anything reads them.
  registerCustomProviders(merged.customProviders.map(customToDef));

  // Make sure the selected provider/model are consistent.
  if (!getProvider(merged.provider)) merged.provider = base.provider;
  if (!merged.model) merged.model = getProvider(merged.provider)?.models[0] ?? "";

  return merged;
}

/** Convert a stored custom provider into a ProviderDef. */
export function customToDef(c: CustomProvider): ProviderDef {
  return {
    id: c.id,
    name: c.name || c.id,
    kind: c.kind ?? "openai",
    baseUrl: c.baseUrl,
    envKey: c.envKey,
    needsKey: false,
    models: c.models ?? [],
    source: "custom",
  };
}

export function saveSettings(settings: Settings): void {
  try {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(configPath(), JSON.stringify(settings, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch (e) {
    // Swallowing this silently made the UI claim "saved automatically" while the change
    // was lost (read-only config dir, full disk, permissions). At least leave a trail.
    logger.warn(`could not save settings to ${configPath()}: ${(e as Error).message}`);
  }
}

/** Split a stored key field into individual keys (comma / semicolon / whitespace separated). */
export function splitApiKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Every API key for a provider, in rotation order: keys from the config first,
 * then any from the environment. Duplicates are dropped.
 */
export function getApiKeys(settings: Settings, providerId: string): string[] {
  const def = getProvider(providerId);
  const envKeys = def?.envKeys ?? (def?.envKey ? [def.envKey] : []);
  const envValues = envKeys.flatMap((envKey) => splitApiKeys(process.env[envKey]));
  return [...new Set([...splitApiKeys(settings.apiKeys[providerId]), ...envValues])];
}

/** The preferred (first) API key for a provider. */
export function getApiKey(settings: Settings, providerId: string): string | undefined {
  return getApiKeys(settings, providerId)[0];
}

export function maskKey(key?: string): string {
  if (!key) return "(not set)";
  const k = key.trim();
  if (k.length <= 8) return "••••";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

/** Display label for one or more keys, e.g. `sk-1234…abcd +2`. */
export function maskKeys(keys: string[]): string {
  if (keys.length === 0) return "(not set)";
  return keys.length > 1 ? `${maskKey(keys[0])} +${keys.length - 1}` : maskKey(keys[0]);
}

export function resolveBaseUrl(settings: Settings, providerId: string): string {
  const override = settings.baseUrls[providerId];
  if (override && override.trim()) return override.trim().replace(/\/+$/, "");
  return (getProvider(providerId)?.baseUrl ?? "").replace(/\/+$/, "");
}

/**
 * Temperature range. Above 1.0 models reliably degrade into nonsense and some
 * providers reject the request, so the UI and config both clamp to [0, 1].
 */
export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 1;

/** Clamp a temperature into the supported range (rounds to 2 decimals). */
export function clampTemperature(n: number): number {
  if (!Number.isFinite(n)) return 0.2;
  const bounded = Math.max(TEMPERATURE_MIN, Math.min(TEMPERATURE_MAX, n));
  return Math.round(bounded * 100) / 100;
}

export function cloneSettings(s: Settings): Settings {  return JSON.parse(JSON.stringify(s)) as Settings;
}
