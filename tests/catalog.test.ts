import { test, expect } from "bun:test";
import {
  allProviders,
  getProvider,
  modelsForProvider,
  modelHint,
  modelInfo,
  modelSupportsTemperature,
  modelSupportsToolCalls,
  providerGroups,
} from "@/core/providers";
import {
  catalogBaseUrl,
  catalogId,
  catalogModels,
  isLocalUrl,
  normalize,
} from "@/core/catalog";
import { supportsVision } from "@/core/vision";
import { registerCustomProviders } from "@/core/providers";
import { customToDef } from "@/core/settings";

test("the models.dev catalog ships a broad provider list", () => {
  const providers = allProviders();
  expect(providers.length).toBeGreaterThan(150);

  const ids = providers.map((p) => p.id);
  for (const expected of ["openai", "anthropic", "google", "openrouter", "groq", "ollama", "gguf"]) {
    expect(ids).toContain(expected);
  }
});

test("provider groups put local runtimes first", () => {
  const groups = providerGroups();
  expect(groups[0]!.title).toBe("Local");
  expect(groups[0]!.providers.map((p) => p.id)).toContain("gguf");
  expect(groups[1]!.title).toBe("Cloud");
  expect(groups[1]!.providers.map((p) => p.id)).toContain("openai");
});

test("catalog model lists are real and newest-first", () => {
  const openai = modelsForProvider("openai");
  expect(openai.length).toBeGreaterThan(10);

  const models = catalogModels("openai");
  const dates = models.map((m) => m.release_date ?? "");
  for (let i = 1; i < dates.length; i++) {
    expect(dates[i - 1]!.localeCompare(dates[i]!)).toBeGreaterThanOrEqual(0);
  }
});

test("FreeLLMAPI ships as a curated local router that still needs its key", () => {  const def = getProvider("freellmapi");
  expect(def).toBeDefined();
  expect(def!.kind).toBe("openai");
  expect(def!.baseUrl).toBe("http://localhost:3001/v1");
  expect(def!.needsKey).toBe(true);
  expect(def!.local).toBe(true);
  expect(def!.envKey).toBe("FREELLMAPI_API_KEY");
  expect(modelsForProvider("freellmapi")).toContain("auto");

  // It sits in the Local group next to the other local runtimes.
  expect(providerGroups()[0]!.providers.map((p) => p.id)).toContain("freellmapi");
});

test("River AI ships as a curated cloud provider needing its key", () => {
  const def = getProvider("river");
  expect(def).toBeDefined();
  expect(def!.kind).toBe("openai");
  expect(def!.baseUrl).toBe("https://api.river.ai/v1");
  expect(def!.needsKey).toBe(true);
  expect(def!.local).toBeUndefined();
  expect(def!.envKey).toBe("RIVER_API_KEY");
  expect(modelsForProvider("river")).toContain("deepseek-ai/DeepSeek-V4.1-Flash");
  expect(providerGroups()[1]!.providers.map((p) => p.id)).toContain("river");
});

test("aliases resolve to the catalog id (together → togetherai)", () => {  expect(catalogId("together")).toBe("togetherai");
  expect(modelsForProvider("together").length).toBeGreaterThan(0);
  // Curated base URL/key still win for the alias.
  const def = getProvider("together");
  expect(def?.baseUrl).toBe("https://api.together.xyz/v1");
  expect(def?.envKey).toBe("TOGETHER_API_KEY");
});

test("model capabilities come from the catalog", () => {
  // Find a vision-capable OpenAI model in the catalog and check it end-to-end.
  const visionModel = catalogModels("openai").find((m) => m.attachment === true);
  expect(visionModel).toBeDefined();

  const info = modelInfo("openai", visionModel!.id);
  expect(info).toBeDefined();
  expect(info!.attachment).toBe(true);
  expect(supportsVision("openai", visionModel!.id)).toBe(true);

  const hint = modelHint("openai", visionModel!.id);
  expect(hint).toContain("vision");
  expect(hint).toContain("tools");
  expect(hint).toContain("ctx");

  // A non-vision model in the catalog must report no vision.
  const textModel = catalogModels("openai").find((m) => m.attachment === false);
  if (textModel) expect(supportsVision("openai", textModel.id)).toBe(false);
});

test("unknown models default to tool/temperature capable", () => {
  expect(modelSupportsToolCalls("ollama", "my-local-model")).toBe(true);
  expect(modelSupportsTemperature("ollama", "my-local-model")).toBe(true);
});

test("placeholder base URLs are rejected", () => {
  expect(
    catalogBaseUrl({
      id: "x",
      name: "X",
      kind: "openai",
      api: "https://${REGION}.example.com/v1",
      env: [],
      models: {},
    }),
  ).toBe("");
  expect(
    catalogBaseUrl({
      id: "x",
      name: "X",
      kind: "openai",
      api: "https://api.example.com/v1/",
      env: [],
      models: {},
    }),
  ).toBe("https://api.example.com/v1");
});

test("isLocalUrl recognises loopback endpoints", () => {
  expect(isLocalUrl("http://127.0.0.1:11434/v1")).toBe(true);
  expect(isLocalUrl("http://localhost:1234/v1")).toBe(true);
  expect(isLocalUrl("https://api.openai.com/v1")).toBe(false);
});

test("normalize() trims a models.dev payload", () => {
  const snap = normalize({
    acme: {
      id: "acme",
      name: "Acme",
      npm: "@ai-sdk/openai-compatible",
      api: "https://llm.acme.example/v1",
      env: ["ACME_API_KEY"],
      models: {
        "coder-v2": {
          id: "coder-v2",
          name: "Coder v2",
          attachment: true,
          tool_call: true,
          temperature: true,
          release_date: "2026-01-01",
          limit: { context: 128000, output: 8192 },
          cost: { input: 0.5, output: 1.5 },
        },
      },
    },
  });
  expect(snap).not.toBeNull();
  const acme = snap!.providers.acme!;
  expect(acme.kind).toBe("openai");
  expect(acme.models["coder-v2"]!.attachment).toBe(true);
  expect(acme.models["coder-v2"]!.limit!.context).toBe(128000);
});

test("buildCatalog keeps providers that lack an `api` field (known base URLs)", () => {
  const snap = normalize({
    openai: { id: "openai", name: "OpenAI", npm: "@ai-sdk/openai", env: ["OPENAI_API_KEY"], models: { m: { id: "m", name: "M" } } },
    groq: { id: "groq", name: "Groq", npm: "@ai-sdk/groq", env: ["GROQ_API_KEY"], models: { g: { id: "g", name: "G" } } },
    google: { id: "google", name: "Google", npm: "@ai-sdk/google", env: ["GEMINI_API_KEY"], models: { g: { id: "g", name: "G" } } },
  });
  expect(snap!.providers.openai!.api).toBe("https://api.openai.com/v1");
  expect(snap!.providers.groq!.api).toBe("https://api.groq.com/openai/v1");
  expect(snap!.providers.google!.kind).toBe("gemini");

  // Providers that need auth we can't do are dropped.
  const withBedrock = normalize({
    "amazon-bedrock": { id: "amazon-bedrock", name: "Bedrock", npm: "@ai-sdk/amazon-bedrock", models: { m: {} } },
  });
  expect(withBedrock).toBeNull();
});

test("user-defined providers become resolvable", () => {
  registerCustomProviders([
    customToDef({
      id: "acme",
      name: "Acme",
      kind: "openai",
      baseUrl: "https://llm.acme.example/v1",
      models: ["coder-v2"],
    }),
  ]);

  const def = getProvider("acme");
  expect(def).toBeDefined();
  expect(def!.source).toBe("custom");
  expect(def!.needsKey).toBe(false);
  expect(modelsForProvider("acme")).toEqual(["coder-v2"]);
  expect(allProviders().map((p) => p.id)).toContain("acme");

  // Clean up so other tests see the original provider set.
  registerCustomProviders([]);
});
