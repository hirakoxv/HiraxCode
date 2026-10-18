import { test, expect } from "bun:test";
import { toOpenAiMessages } from "@/providers/openai";
import { toAnthropicMessages } from "@/providers/anthropic";
import { toGeminiContents } from "@/providers/gemini";
import { supportsVision, visionHint } from "@/core/vision";
import { shellArgv } from "@/agent/tools";
import { buildLlamaServerArgs } from "@/providers/llama";
import { platform } from "os";
import type { Message } from "@/core/types";

const IMG = { mime: "image/png", data: "QUJD", name: "shot.png" };

const userWithImage: Message = {
  id: "u",
  role: "user",
  content: "what's in this screenshot?",
  timestamp: 0,
  images: [IMG],
};

test("openai wires images as image_url data URIs", () => {
  const wire = toOpenAiMessages([userWithImage]);
  const content = wire[0]!.content as Array<Record<string, unknown>>;
  expect(Array.isArray(content)).toBe(true);
  expect(content[0]).toEqual({ type: "text", text: "what's in this screenshot?" });
  expect(content[1]).toMatchObject({
    type: "image_url",
    image_url: { url: "data:image/png;base64,QUJD" },
  });
});

test("openai keeps plain strings when there are no images", () => {
  const wire = toOpenAiMessages([
    { id: "u", role: "user", content: "hi", timestamp: 0 },
  ]);
  expect(wire[0]!.content).toBe("hi");
});

test("anthropic wires images as base64 source blocks", () => {
  const msgs = toAnthropicMessages([userWithImage]);
  const blocks = msgs[0]!.content as Array<Record<string, any>>;
  expect(blocks.find((b) => b.type === "text")?.text).toBe("what's in this screenshot?");
  expect(blocks.find((b) => b.type === "image")).toMatchObject({
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJD" },
  });
});

test("gemini wires images as inlineData parts", () => {
  const contents = toGeminiContents([userWithImage]);
  const parts = contents[0]!.parts as Array<Record<string, any>>;
  expect(parts.find((p) => "text" in p)?.text).toBe("what's in this screenshot?");
  expect(parts.find((p) => "inlineData" in p)?.inlineData).toEqual({
    mimeType: "image/png",
    data: "QUJD",
  });
});

test("vision detection covers cloud and local models", () => {
  expect(supportsVision("google", "gemini-flash-latest")).toBe(true);
  expect(supportsVision("anthropic", "claude-sonnet-4-5")).toBe(true);
  expect(supportsVision("openai", "gpt-4.1")).toBe(true);
  expect(supportsVision("openai", "gpt-4o")).toBe(true);
  expect(supportsVision("openai", "gpt-3.5-turbo")).toBe(false);

  // local runtimes depend on the model tag
  expect(supportsVision("ollama", "llava")).toBe(true);
  expect(supportsVision("ollama", "qwen2.5-vl:7b")).toBe(true);
  expect(supportsVision("ollama", "llama3.2:3b")).toBe(false);
  expect(supportsVision("lmstudio", "moondream2")).toBe(true);

  // gguf needs a multimodal projector
  expect(supportsVision("gguf", "local-gguf")).toBe(false);
  expect(supportsVision("gguf", "local-gguf", { mmproj: true })).toBe(true);
});

test("vision hint points at provider-specific fixes", () => {
  expect(visionHint("openai")).toContain("gpt");
  expect(visionHint("gguf")).toContain("mmproj");
  expect(visionHint("nope")).toContain("/model");
});

test("run_bash picks a shell that exists on this platform", () => {
  const argv = shellArgv("echo hi");
  expect(argv.length).toBeGreaterThanOrEqual(3);
  if (platform() === "win32") {
    expect(/powershell|pwsh|cmd/i.test(argv[0]!)).toBe(true);
  } else {
    expect(argv[1]).toBe("-lc");
  }
});

test("llama-server is started with --jinja so `tools` is accepted", () => {
  const base = { ggufPath: "/models/m.gguf" };
  const args = buildLlamaServerArgs("llama-server", 8181, base);
  expect(args).toContain("--jinja");
  expect(args.slice(0, 3)).toEqual(["llama-server", "-m", "/models/m.gguf"]);
  expect(args).toContain("--port");
  expect(args[args.indexOf("--port") + 1]).toBe("8181");
});

test("llama-server flags: mmproj added, jinja not duplicated / can be disabled", () => {
  const withMmproj = buildLlamaServerArgs("llama-server", 8080, {
    ggufPath: "/m.gguf",
    mmproj: "/mm.gguf",
  });
  expect(withMmproj).toContain("--mmproj");
  expect(withMmproj[withMmproj.indexOf("--mmproj") + 1]).toBe("/mm.gguf");

  const explicit = buildLlamaServerArgs("llama-server", 8080, {
    ggufPath: "/m.gguf",
    extra: ["--jinja"],
  });
  expect(explicit.filter((a) => a === "--jinja")).toHaveLength(1);

  const disabled = buildLlamaServerArgs("llama-server", 8080, {
    ggufPath: "/m.gguf",
    jinja: false,
  });
  expect(disabled).not.toContain("--jinja");

  const viaArgs = buildLlamaServerArgs("llama-server", 8080, {
    ggufPath: "/m.gguf",
    extra: ["--no-jinja"],
  });
  expect(viaArgs).not.toContain("--jinja");
});
