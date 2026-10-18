import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import rawSnapshot from "./models-dev.snapshot.json";
import { logger } from "@/utils/logger";

/**
 * Provider/model catalog sourced from https://models.dev. The bundled snapshot
 * makes every provider and model (and its capabilities) available offline; a
 * background refresh updates the on-disk cache for the next launch.
 */

export type CatalogKind = "openai" | "anthropic" | "gemini";

export interface CatalogModel {
  id: string;
  name: string;
  /** Accepts image input. */
  attachment?: boolean;
  /** Supports reasoning / thinking. */
  reasoning?: boolean;
  /** Supports tool calling. */
  tool_call?: boolean;
  /** Accepts a `temperature` parameter. */
  temperature?: boolean;
  release_date?: string;
  limit?: { context?: number; output?: number; input?: number };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
}

export interface CatalogProvider {
  id: string;
  name: string;
  kind: CatalogKind;
  /** Base URL. May contain a `${VAR}` placeholder when the provider needs one. */
  api: string;
  /** Ordered environment variables that can supply the credential. */
  env: string[];
  doc?: string;
  npm?: string;
  models: Record<string, CatalogModel>;
}

export interface CatalogSnapshot {
  generatedAt: string;
  source: string;
  providers: Record<string, CatalogProvider>;
}

/** HiraxCode's curated provider ids → models.dev provider ids. */
export const CATALOG_ALIASES: Record<string, string> = {
  together: "togetherai",
};

/**
 * Providers that don't publish an `api` base URL but have a well-known one.
 * Shared with scripts/gen-catalog.mjs so the bundled snapshot and the live
 * refresh stay identical.
 */
export const KNOWN_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
  groq: "https://api.groq.com/openai/v1",
  xai: "https://api.x.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  deepinfra: "https://api.deepinfra.com/v1/openai",
  cerebras: "https://api.cerebras.ai/v1",
  cohere: "https://api.cohere.ai/compatibility/v1",
  perplexity: "https://api.perplexity.ai",
  venice: "https://api.venice.ai/api/v1",
  togetherai: "https://api.together.xyz/v1",
  aihubmix: "https://aihubmix.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
};

/** npm packages whose auth flows we cannot do from a plain HTTP client. */
export const UNSUPPORTED_NPM: string[] = [
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/google-vertex",
  "@ai-sdk/azure",
  "@ai-sdk/gateway",
  "ai-gateway-provider",
  "watsonx-ai-provider",
  "@jerome-benoit/sap-ai-provider-v2",
  "gitlab-ai-provider",
  "@saladtechnologies-oss/ai-sdk-provider",
  "@qvac/ai-sdk-provider",
];

function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "hiraxcode");
}

export function catalogCachePath(): string {
  return join(cacheDir(), "models-dev.json");
}

function readCache(): CatalogSnapshot | null {
  try {
    const p = catalogCachePath();
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as CatalogSnapshot;
    if (parsed && parsed.providers && Object.keys(parsed.providers).length > 0) {
      return parsed;
    }
  } catch (e) {
    logger.debug("catalog cache unreadable", (e as Error).message);
  }
  return null;
}

let catalog: CatalogSnapshot = loadInitial();

function loadInitial(): CatalogSnapshot {
  const bundled = rawSnapshot as unknown as CatalogSnapshot;
  const cached = readCache();
  if (!cached) return bundled;
  // Prefer whichever snapshot was generated most recently.
  const c = Date.parse(cached.generatedAt) || 0;
  const b = Date.parse(bundled.generatedAt) || 0;
  return c > b ? cached : bundled;
}

/** Replace the in-memory catalog (used after a successful refresh). */
export function setCatalog(next: CatalogSnapshot): void {
  if (next?.providers && Object.keys(next.providers).length > 0) catalog = next;
}

/**
 * Download the latest catalog and cache it. Returns true when the catalog was
 * updated in memory. Never throws.
 */
export async function refreshCatalog(): Promise<boolean> {
  if (process.env.HIRAX_NO_REFRESH === "1") return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch("https://models.dev/api.json", { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const json = (await res.json()) as unknown;
    const next = buildCatalog(json);
    if (!next) return false;
    setCatalog(next);
    try {
      mkdirSync(cacheDir(), { recursive: true });
      writeFileSync(catalogCachePath(), JSON.stringify(next), "utf-8");
    } catch (e) {
      logger.debug("catalog cache write failed", (e as Error).message);
    }
    return true;
  } catch (e) {
    logger.debug("catalog refresh failed", (e as Error).message);
    return false;
  }
}

/** Coerce the raw models.dev payload into our trimmed shape. */
export function buildCatalog(raw: unknown): CatalogSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const providers: Record<string, CatalogProvider> = {};
  for (const [id, value] of Object.entries(raw as Record<string, any>)) {
    if (!value || typeof value !== "object") continue;

    const npm: string = value.npm ?? "";
    const api: string | undefined = value.api ?? KNOWN_BASE_URLS[id];
    if (!api) continue;
    if (UNSUPPORTED_NPM.some((u) => npm === u || npm.startsWith(u + "/"))) continue;

    const models: Record<string, CatalogModel> = {};
    for (const [mid, m] of Object.entries((value.models ?? {}) as Record<string, any>)) {
      if (!m || typeof m !== "object") continue;
      if (m.status === "deprecated" || m.disabled) continue;
      models[mid] = trimModel(mid, m);
    }
    if (Object.keys(models).length === 0) continue;

    providers[id] = {
      id,
      name: value.name ?? id,
      kind: kindFor(npm, id),
      api,
      env: Array.isArray(value.env) ? value.env : [],
      ...(value.doc ? { doc: value.doc } : {}),
      ...(npm ? { npm } : {}),
      models,
    };
  }
  if (Object.keys(providers).length === 0) return null;
  return { generatedAt: new Date().toISOString(), source: "https://models.dev/api.json", providers };
}

function trimModel(mid: string, m: Record<string, any>): CatalogModel {
  const out: CatalogModel = { id: m.id ?? mid, name: m.name ?? mid };
  for (const k of ["attachment", "reasoning", "tool_call", "temperature", "release_date"] as const) {
    if (m[k] !== undefined) (out as any)[k] = m[k];
  }
  if (m.limit) out.limit = m.limit;
  if (m.cost) out.cost = m.cost;
  return out;
}

/** Backwards-compatible alias. */
export const normalize = buildCatalog;

function kindFor(npm: string, id: string): CatalogKind {
  if (/anthropic/i.test(npm) && !/vertex/i.test(npm)) return "anthropic";
  if (npm === "@ai-sdk/google" || npm.startsWith("@ai-sdk/google-vertex")) return "gemini";
  if (id === "anthropic") return "anthropic";
  if (id === "google") return "gemini";
  return "openai";
}

/** Resolve a HiraxCode provider id to its models.dev provider id. */
export function catalogId(providerId: string): string {
  return CATALOG_ALIASES[providerId] ?? providerId;
}

export function catalogProvider(providerId: string): CatalogProvider | undefined {
  return catalog.providers[catalogId(providerId)];
}

export function catalogProviderList(): CatalogProvider[] {
  return Object.values(catalog.providers);
}

export function hasCatalog(providerId: string): boolean {
  return Boolean(catalog.providers[catalogId(providerId)]);
}

/** All models for a provider, newest release first. */
export function catalogModels(providerId: string): CatalogModel[] {
  const p = catalogProvider(providerId);
  if (!p) return [];
  return Object.values(p.models).sort((a, b) =>
    String(b.release_date ?? "").localeCompare(String(a.release_date ?? "")),
  );
}

export function catalogModel(
  providerId: string,
  modelId: string,
): CatalogModel | undefined {
  const p = catalogProvider(providerId);
  if (!p) return undefined;
  return p.models[modelId];
}

export function catalogGeneratedAt(): string {
  return catalog.generatedAt;
}

/** A base URL is usable only when it is a concrete http(s) endpoint. */
export function catalogBaseUrl(p: CatalogProvider): string {
  if (!p.api) return "";
  if (p.api.includes("${") || p.api.includes("{env:")) return "";
  return p.api.replace(/\/+$/, "");
}

export function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url);
}
