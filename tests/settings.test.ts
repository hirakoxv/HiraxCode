import { test, expect, beforeEach } from "bun:test";
import { rmSync } from "fs";
import {
  clampTemperature,
  configPath,
  defaultsFromEnv,
  getApiKey,
  getApiKeys,
  loadSettings,
  maskKeys,
  resolveBaseUrl,
  saveSettings,
  splitApiKeys,
  type Settings,
} from "@/core/settings";

beforeEach(() => {
  try {
    rmSync(configPath(), { force: true });
  } catch {
    // ignore
  }
});

test("defaults pick OpenRouter and no key", () => {
  const s = defaultsFromEnv();
  expect(s.provider).toBe("openrouter");
  expect(s.model.length).toBeGreaterThan(0);
});

test("env vars populate keys, provider and base url", () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  process.env.HIRAX_PROVIDER = "anthropic";
  process.env.BASE_URL = "https://proxy.example.com/v1";

  const s = defaultsFromEnv();
  expect(s.provider).toBe("anthropic");
  expect(getApiKey(s, "anthropic")).toBe("sk-ant-test");
  expect(resolveBaseUrl(s, "anthropic")).toBe("https://proxy.example.com/v1");

  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.HIRAX_PROVIDER;
  delete process.env.BASE_URL;
});

test("settings round-trip through disk", () => {
  const s: Settings = {
    ...defaultsFromEnv(),
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    apiKeys: { groq: "gsk_test" },
    baseUrls: { groq: "https://custom/v1/" },
    temperature: 0.9,
    accent: "#a78bfa",
    showSidebar: true,
  };

  saveSettings(s);
  const loaded = loadSettings();

  expect(loaded.provider).toBe("groq");
  expect(loaded.model).toBe("llama-3.3-70b-versatile");
  expect(getApiKey(loaded, "groq")).toBe("gsk_test");
  // trailing slash is normalised away
  expect(resolveBaseUrl(loaded, "groq")).toBe("https://custom/v1");
  expect(loaded.accent).toBe("#a78bfa");
  expect(loaded.showSidebar).toBe(true);
});

test("splitApiKeys accepts commas, semicolons and newlines", () => {
  expect(splitApiKeys("a,b , c")).toEqual(["a", "b", "c"]);
  expect(splitApiKeys("a;b\nc")).toEqual(["a", "b", "c"]);
  expect(splitApiKeys("  ")).toEqual([]);
  expect(splitApiKeys(undefined)).toEqual([]);
});

test("getApiKeys returns multiple keys in rotation order", () => {
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const s: Settings = {
    ...defaultsFromEnv(),
    provider: "openrouter",
    model: "x",
    apiKeys: { openrouter: "key-one, key-two\nkey-three" },
  };

  expect(getApiKeys(s, "openrouter")).toEqual(["key-one", "key-two", "key-three"]);
  // getApiKey stays the preferred (first) key.
  expect(getApiKey(s, "openrouter")).toBe("key-one");
  expect(maskKeys(getApiKeys(s, "openrouter"))).toContain("+2");

  if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
});

test("getApiKeys dedupes and appends env keys", () => {
  process.env.GROQ_API_KEY = "env-key";
  const s: Settings = {
    ...defaultsFromEnv(),
    provider: "groq",
    model: "x",
    apiKeys: { groq: "cfg-key,cft-key,env-key" },
  };

  const keys = getApiKeys(s, "groq");
  expect(keys).toEqual(["cfg-key", "cft-key", "env-key"]);
  delete process.env.GROQ_API_KEY;
});

test("clampTemperature keeps values inside 0–1", () => {
  expect(clampTemperature(0.2)).toBe(0.2);
  expect(clampTemperature(0.35)).toBe(0.35);
  expect(clampTemperature(-1)).toBe(0);
  expect(clampTemperature(2)).toBe(1);
  expect(clampTemperature(99)).toBe(1);
  expect(clampTemperature(Number.NaN)).toBe(0.2);
  expect(clampTemperature(0.333333)).toBe(0.33);
});

test("loadSettings clamps an out-of-range temperature from disk", () => {
  saveSettings({ ...defaultsFromEnv(), provider: "openrouter", model: "x", temperature: 2 });
  expect(loadSettings().temperature).toBe(1);

  saveSettings({ ...defaultsFromEnv(), provider: "openrouter", model: "x", temperature: 0.4 });
  expect(loadSettings().temperature).toBe(0.4);
});
