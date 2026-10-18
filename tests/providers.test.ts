import { test, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { AnthropicProvider, toAnthropicMessages } from "@/providers/anthropic";
import { GeminiProvider, toGeminiContents } from "@/providers/gemini";
import { OpenAiProvider, toOpenAiMessages } from "@/providers/openai";
import { toOpenAiTools, toGeminiTools, sanitizeForGemini } from "@/agent/tool-schema";
import { ToolRegistry } from "@/agent/tool-registry";
import { AgentLoop } from "@/agent/loop";
import { supportsReasoningEffort } from "@/providers/openai";
import { supportsThinking } from "@/providers/anthropic";
import { findLlamaBin } from "@/providers/llama";
import { formatApiError } from "@/providers/types";
import type { Message } from "@/core/types";
import type { StreamEvent } from "@/providers/types";

const collect = async (gen: AsyncGenerator<StreamEvent>) => {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
};

function sseResponse(events: unknown[]): Response {
  const body =
    events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

const sseData = (payloads: unknown[]): Response =>
  new Response(payloads.map((p) => `data: ${JSON.stringify(p)}` + "\n\n").join(""), {
    headers: { "content-type": "text/event-stream" },
  });

const baseReq = {
  messages: [{ id: "u", role: "user" as const, content: "hi", timestamp: 0 }],
  tools: [],
  model: "m",
  systemPrompt: "sys",
};

// ── Anthropic ───────────────────────────────────────────────────────────────
let anthropicServer: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  anthropicServer = Bun.serve({
    port: 0,
    fetch() {
      return sseResponse([
        { type: "message_start", message: { usage: { input_tokens: 7, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_1", name: "read_file", input: {} },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"path":"a.ts"}' },
        },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } },
        { type: "message_stop" },
      ]);
    },
  });
});

afterAll(() => anthropicServer.stop(true));

test("Anthropic streams text and a tool call", async () => {
  const provider = new AnthropicProvider({
    baseUrl: `http://localhost:${anthropicServer.port}`,
    apiKey: "test",
  });
  const events = await collect(provider.stream(baseReq));

  const text = events.filter((e) => e.type === "content").map((e: any) => e.content).join("");
  expect(text).toBe("Hello world");

  const call = events.find((e) => e.type === "tool_call");
  expect(call).toBeDefined();
  if (call?.type === "tool_call") {
    expect(call.toolCall.name).toBe("read_file");
    expect(call.toolCall.args).toEqual({ path: "a.ts" });
  }
});

test("Anthropic converts tool results into user blocks", () => {
  const msgs: Message[] = [
    { id: "u", role: "user", content: "read a", timestamp: 0 },
    {
      id: "a",
      role: "assistant",
      content: "",
      timestamp: 0,
      toolCallId: "t1",
      toolName: "read_file",
      toolArgs: { path: "a.ts" },
    },
    {
      id: "t",
      role: "tool",
      content: "",
      timestamp: 0,
      toolCallId: "t1",
      toolName: "read_file",
      toolResult: { success: true, output: "code" },
    },
  ];
  const wire = toAnthropicMessages(msgs);
  expect(wire[1]!.content[0]).toMatchObject({ type: "tool_use", id: "t1" });
  expect(wire[2]!.role).toBe("user");
  expect(wire[2]!.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
});

// ── Gemini ──────────────────────────────────────────────────────────────────
let geminiServer: ReturnType<typeof Bun.serve>;
let lastGeminiBody: any = null;

beforeAll(() => {
  geminiServer = Bun.serve({
    port: 0,
    async fetch(req) {
      lastGeminiBody = await req.json().catch(() => null);
      return sseData([
        {
          candidates: [{ content: { role: "model", parts: [{ text: "Hi " }] } }],
        },
        {
          candidates: [{ content: { role: "model", parts: [{ text: "there" }] } }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
        },
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ functionCall: { name: "list_dir", args: { path: "." } } }],
              },
            },
          ],
        },
      ]);
    },
  });
});

afterAll(() => geminiServer.stop(true));

test("Gemini streams text and a function call", async () => {
  const provider = new GeminiProvider({
    baseUrl: `http://localhost:${geminiServer.port}`,
    apiKey: "test",
  });
  const tools = new ToolRegistry().getAll();
  const events = await collect(provider.stream({ ...baseReq, tools }));

  const text = events.filter((e) => e.type === "content").map((e: any) => e.content).join("");
  expect(text).toBe("Hi there");

  const call = events.find((e) => e.type === "tool_call");
  expect(call).toBeDefined();
  if (call?.type === "tool_call") expect(call.toolCall.name).toBe("list_dir");

  const usage = events.find((e) => e.type === "usage");
  expect(usage).toBeDefined();

  // The real request body sent to Google must be free of unsupported keys.
  const json = JSON.stringify(lastGeminiBody);
  expect(json).not.toContain("additionalProperties");
  expect(json).not.toContain("$schema");
  expect(lastGeminiBody.tools[0].functionDeclarations.length).toBe(tools.length);
});

test("Gemini tool declarations are sanitized (no list types, no extra keys)", () => {
  const tools = toGeminiTools(new ToolRegistry().getAll());

  const walk = (schema: any): void => {
    if (!schema || typeof schema !== "object") return;
    expect(Array.isArray(schema.type)).toBe(false);
    expect("additionalProperties" in schema).toBe(false);
    expect("$schema" in schema).toBe(false);
    if (schema.properties) for (const v of Object.values(schema.properties)) walk(v);
    if (schema.items) walk(schema.items);
  };

  for (const t of tools) walk(t.parameters);

  // optional zod fields stay typed and are simply not required
  const readFile = tools.find((t) => t.name === "read_file")!;
  const offset = (readFile.parameters.properties as any).offset;
  expect(offset.type).toBe("integer");
  expect(readFile.parameters.required).toEqual(["path"]);
});

test("provider errors are surfaced as a chat message", async () => {
  const loop = new AgentLoop();
  const failing = {
    id: "x",
    kind: "openai" as const,
    async *stream() {
      yield { type: "error" as const, error: "API 400: bad request" };
    },
  };

  const result = await loop.run({
    messages: [{ id: "u", role: "user", content: "hi", timestamp: 0 }],
    provider: failing as any,
    model: "m",
    systemPrompt: "",
    workingDir: process.cwd(),
    autoApproveSafeTools: true,
    onEvent: () => {},
    onApproval: async () => true,
  });

  const last = result[result.length - 1];
  expect(last?.role).toBe("assistant");
  expect(last?.content).toContain("API 400: bad request");
});

test("Gemini converts tool results into functionResponse parts", () => {
  const msgs: Message[] = [
    {
      id: "a",
      role: "assistant",
      content: "",
      timestamp: 0,
      toolCallId: "c",
      toolName: "list_dir",
      toolArgs: {},
    },
    {
      id: "t",
      role: "tool",
      content: "",
      timestamp: 0,
      toolCallId: "c",
      toolName: "list_dir",
      toolResult: { success: true, output: "a\nb" },
    },
  ];
  const contents = toGeminiContents(msgs);
  expect(contents[0]!.role).toBe("model");
  expect(contents[1]!.parts[0]).toHaveProperty("functionResponse");
});

// ── OpenAI wire format ──────────────────────────────────────────────────────
test("OpenAI wire format groups tool calls with their results", () => {
  const wire = toOpenAiMessages(
    [
      { id: "u", role: "user", content: "read a", timestamp: 0 },
      {
        id: "a",
        role: "assistant",
        content: "",
        timestamp: 0,
        toolCallId: "c1",
        toolName: "read_file",
        toolArgs: { path: "a.ts" },
      },
      {
        id: "t",
        role: "tool",
        content: "",
        timestamp: 0,
        toolCallId: "c1",
        toolName: "read_file",
        toolResult: { success: true, output: "x" },
      },
    ],
    "sys",
  );

  expect(wire[0]).toEqual({ role: "system", content: "sys" });
  expect(wire[2]!.tool_calls?.[0]?.function.name).toBe("read_file");
  expect(wire[3]).toMatchObject({ role: "tool", tool_call_id: "c1", content: "x" });
});

test("tool schemas are valid OpenAI function definitions", () => {
  const tools = toOpenAiTools([
    {
      name: "demo",
      description: "d",
      parameters: z.object({ path: z.string() }),
    },
  ]);
  expect(tools[0]!.type).toBe("function");
  expect(tools[0]!.function.parameters).toHaveProperty("properties");
});

test("reasoning params are only sent to capable models", () => {
  expect(supportsReasoningEffort("gpt-4.1")).toBe(false);
  expect(supportsReasoningEffort("gpt-4o")).toBe(false);
  expect(supportsReasoningEffort("o3-mini")).toBe(true);
  expect(supportsReasoningEffort("gpt-5")).toBe(true);

  expect(supportsThinking("claude-3-5-sonnet-latest")).toBe(false);
  expect(supportsThinking("claude-3-7-sonnet-latest")).toBe(true);
  expect(supportsThinking("claude-sonnet-4-5")).toBe(true);
  expect(supportsThinking("claude-opus-4-1")).toBe(true);

  // Dated 3.x ids contain a "4" in the date. They do not support thinking, and treating
  // them as if they did makes the API reject the request.
  expect(supportsThinking("claude-3-5-sonnet-20240620")).toBe(false);
  expect(supportsThinking("claude-3-5-haiku-20241022")).toBe(false);
  expect(supportsThinking("claude-3-opus-20240229")).toBe(false);
  expect(supportsThinking("claude-3-haiku-20240307")).toBe(false);
  expect(supportsThinking("claude-2.1")).toBe(false);

  // 4.x families, with and without a dated suffix.
  expect(supportsThinking("claude-opus-4-20250514")).toBe(true);
  expect(supportsThinking("claude-haiku-4-5")).toBe(true);
  expect(supportsThinking("claude-4-sonnet")).toBe(true);
});

test("findLlamaBin reports a missing binary instead of throwing", () => {
  expect(findLlamaBin("hirax-definitely-not-installed-xyz")).toBeNull();
});

test("API errors are unwrapped and get a /model hint", () => {
  const body = JSON.stringify({
    error: {
      code: 404,
      message:
        "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements.",
    },
  });

  const msg = formatApiError(404, body);
  expect(msg).toContain("no longer available");
  expect(msg).toContain("/model");
  expect(msg).not.toContain("{");
  expect(msg.startsWith("API 404:")).toBe(true);

  expect(formatApiError(500, "boom")).toBe("API 500: boom");
});

test("transient 503 responses are retried automatically", async () => {
  let calls = 0;
  const flaky = Bun.serve({
    port: 0,
    fetch() {
      calls++;
      if (calls === 1) {
        return Response.json({ error: { code: 503, message: "high demand" } }, { status: 503 });
      }
      return sseData([
        { candidates: [{ content: { role: "model", parts: [{ text: "recovered" }] } }] },
      ]);
    },
  });

  const provider = new GeminiProvider({
    baseUrl: `http://localhost:${flaky.port}`,
    apiKey: "test",
  });

  const events = await collect(provider.stream({ ...baseReq, tools: [] }));
  const text = events.filter((e) => e.type === "content").map((e: any) => e.content).join("");

  expect(text).toBe("recovered");
  expect(events.some((e) => e.type === "error")).toBe(false);
  expect(calls).toBe(2);

  flaky.stop(true);
});

test("a persistent 503 becomes a visible error", async () => {
  const dead = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ error: { code: 503, message: "high demand" } }, { status: 503 });
    },
  });

  const provider = new GeminiProvider({
    baseUrl: `http://localhost:${dead.port}`,
    apiKey: "test",
  });

  const events = await collect(provider.stream({ ...baseReq, tools: [] }));
  const err = events.find((e) => e.type === "error");
  expect(err).toBeDefined();
  if (err?.type === "error") expect(err.error).toContain("high demand");

  dead.stop(true);
});

test("rotates to the next API key when one is rejected", async () => {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const auth = req.headers.get("authorization") ?? "";
      seen.push(auth);
      if (auth === "Bearer dead-key") {
        return Response.json({ error: { message: "invalid api key" } }, { status: 401 });
      }
      return sseData([
        { choices: [{ delta: { content: "rotated ok" }, finish_reason: "stop" }] },
      ]);
    },
  });

  const provider = new OpenAiProvider({
    id: "openrouter",
    baseUrl: `http://localhost:${server.port}/v1`,
    apiKeys: ["dead-key", "live-key"],
  });

  const events = await collect(provider.stream({ ...baseReq, tools: [] }));
  const text = events.filter((e) => e.type === "content").map((e: any) => e.content).join("");

  expect(text).toBe("rotated ok");
  expect(events.some((e) => e.type === "error")).toBe(false);
  expect(events.some((e) => e.type === "notice")).toBe(true);
  expect(seen).toEqual(["Bearer dead-key", "Bearer live-key"]);

  server.stop(true);
});

test("all keys rejected surfaces the last error", async () => {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      calls++;
      return Response.json({ error: { message: "quota exceeded" } }, { status: 429 });
    },
  });

  const provider = new OpenAiProvider({
    id: "openrouter",
    baseUrl: `http://localhost:${server.port}/v1`,
    apiKeys: ["k1", "k2"],
  });

  const events = await collect(provider.stream({ ...baseReq, tools: [] }));
  const err = events.find((e) => e.type === "error");
  expect(err).toBeDefined();
  if (err?.type === "error") expect(err.error).toContain("quota exceeded");
  // Both keys were tried (429 is retried per key, so just assert >= 2).
  expect(calls).toBeGreaterThanOrEqual(2);

  server.stop(true);
});

test("requiresKey makes a localhost provider demand its unified key", async () => {
  // FreeLLMAPI lives on localhost but still needs its freellmapi-… token.
  const provider = new OpenAiProvider({
    id: "freellmapi",
    baseUrl: "http://localhost:3001/v1",
    requiresKey: true,
  });

  const events = await collect(provider.stream({ ...baseReq, tools: [] }));
  const err = events.find((e) => e.type === "error");
  expect(err).toBeDefined();
  if (err?.type === "error") expect(err.error).toContain("No API key");

  // Without requiresKey, a localhost endpoint is treated as keyless.
  const keyless = new OpenAiProvider({
    id: "custom",
    baseUrl: "http://localhost:1/v1",
  });
  const out = await collect(keyless.stream({ ...baseReq, tools: [] }));
  const e2 = out.find((e) => e.type === "error");
  expect(e2 && e2.type === "error" ? e2.error : "").not.toContain("No API key");
});

