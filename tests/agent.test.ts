import { test, expect, beforeAll, afterAll } from "bun:test";
import { AgentLoop, type AgentEvent } from "@/agent/loop";
import { OpenAiProvider } from "@/providers/openai";
import type { Message } from "@/core/types";

/**
 * A tiny OpenAI-compatible SSE mock. On the first request it "decides" to call
 * read_file; on the second (after seeing the tool result) it answers.
 */
let server: ReturnType<typeof Bun.serve>;
let baseUrl = "";

function sse(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
}

const chunk = (delta: unknown, finish: string | null = null) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: Date.now(),
  model: "mock/model",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname.endsWith("/models")) {
        return Response.json({ data: [{ id: "mock/model" }, { id: "mock/model-2" }] });
      }

      const body = (await req.json()) as { messages: { role: string }[] };
      const hasToolResult = body.messages.some((m) => m.role === "tool");

      if (!hasToolResult) {
        return new Response(
          sse([
            chunk({
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: '{"path":' },
                },
              ],
            }),
            chunk({
              tool_calls: [{ index: 0, function: { arguments: '"package.json"}' } }],
            }),
            chunk({}, "tool_calls"),
          ]),
          { headers: { "content-type": "text/event-stream" } },
        );
      }

      return new Response(
        sse([
          chunk({ role: "assistant", content: "The package is " }),
          chunk({ content: '"hiraxcode".' }),
          chunk({}, "stop"),
        ]),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  baseUrl = `http://localhost:${server.port}/v1`;
});

afterAll(() => server.stop(true));

function makeProvider() {
  return new OpenAiProvider({ id: "openai", baseUrl, apiKey: "test-key" });
}

test("assistant text is not repeated on every tool-call message", async () => {
  const dupServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { messages: { role: string }[] };
      if (body.messages.some((m) => m.role === "tool")) {
        return new Response(sse([chunk({ role: "assistant", content: "all done" }), chunk({}, "stop")]), {
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response(
        sse([
          chunk({ role: "assistant", content: "Let me look around." }),
          chunk({
            tool_calls: [
              {
                index: 0,
                id: "call_a",
                type: "function",
                function: { name: "list_dir", arguments: "{}" },
              },
              {
                index: 1,
                id: "call_b",
                type: "function",
                function: { name: "list_dir", arguments: '{"path":"."}' },
              },
            ],
          }),
          chunk({}, "tool_calls"),
        ]),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });

  try {
    const result = await new AgentLoop().run({
      messages: [{ id: "u1", role: "user", content: "look around", timestamp: Date.now() }],
      provider: new OpenAiProvider({
        id: "openai",
        baseUrl: `http://localhost:${dupServer.port}/v1`,
        apiKey: "test-key",
      }),
      model: "mock/model",
      systemPrompt: "you are a test",
      workingDir: process.cwd(),
      temperature: 0,
      autoApproveSafeTools: true,
      onEvent: () => {},
      onApproval: async () => true,
    });

    // The text belongs to exactly one message, however many tools the turn called.
    const withText = result.filter((m) => m.role === "assistant" && m.content.includes("Let me look"));
    expect(withText).toHaveLength(1);

    const toolMessages = result.filter((m) => m.role === "assistant" && m.toolName);
    expect(toolMessages).toHaveLength(2);
    for (const m of toolMessages) expect(m.content).toBe("");
  } finally {
    dupServer.stop(true);
  }
});

test("agent loop calls a tool then answers", async () => {
  const events: AgentEvent[] = [];
  const conversation: Message[] = [
    { id: "u1", role: "user", content: "what's this package?", timestamp: Date.now() },
  ];

  const result = await new AgentLoop().run({
    messages: conversation,
    provider: makeProvider(),
    model: "mock/model",
    systemPrompt: "you are a test",
    workingDir: process.cwd(),
    temperature: 0,
    autoApproveSafeTools: true,
    onEvent: (e) => events.push(e),
    onApproval: async () => true,
  });

  expect(events.some((e) => e.type === "tool_call")).toBe(true);

  const toolResult = events.find((e) => e.type === "tool_result");
  expect(toolResult).toBeDefined();
  if (toolResult?.type === "tool_result") {
    expect(toolResult.message.toolResult?.success).toBe(true);
    expect(toolResult.message.toolResult?.output).toContain("hiraxcode");
  }

  const final = result[result.length - 1];
  expect(final?.role).toBe("assistant");
  expect(final?.content).toContain("hiraxcode");
});

test("agent requests approval for dangerous tools and respects denial", async () => {
  const approvalServer = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        sse([
          chunk({
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_9",
                type: "function",
                function: { name: "run_bash", arguments: '{"command":"echo nope"}' },
              },
            ],
          }),
          chunk({}, "tool_calls"),
        ]),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });

  const events: AgentEvent[] = [];
  const result = await new AgentLoop().run({
    messages: [{ id: "u", role: "user", content: "run it", timestamp: Date.now() }],
    provider: new OpenAiProvider({
      id: "openai",
      baseUrl: `http://localhost:${approvalServer.port}/v1`,
      apiKey: "test-key",
    }),
    model: "mock/model",
    systemPrompt: "test",
    workingDir: process.cwd(),
    autoApproveSafeTools: true,
    maxTurns: 1,
    onEvent: (e) => events.push(e),
    onApproval: async () => false,
  });

  expect(events.some((e) => e.type === "approval_request")).toBe(true);
  const denied = result.find((m) => m.role === "tool");
  expect(denied?.toolResult?.success).toBe(false);
  expect(denied?.toolResult?.error).toContain("denied");

  approvalServer.stop(true);
});

test("autoApproveAll runs dangerous tools without asking", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        sse([
          chunk({
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_auto",
                type: "function",
                function: { name: "run_bash", arguments: '{"command":"echo auto-ran"}' },
              },
            ],
          }),
          chunk({}, "tool_calls"),
        ]),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });

  const events: AgentEvent[] = [];
  let asked = false;
  const result = await new AgentLoop().run({
    messages: [{ id: "u", role: "user", content: "run it", timestamp: Date.now() }],
    provider: new OpenAiProvider({
      id: "openai",
      baseUrl: `http://localhost:${server.port}/v1`,
      apiKey: "test-key",
    }),
    model: "mock/model",
    systemPrompt: "test",
    workingDir: process.cwd(),
    autoApproveSafeTools: true,
    autoApproveAll: true,
    maxTurns: 1,
    onEvent: (e) => events.push(e),
    onApproval: async () => {
      asked = true;
      return false;
    },
  });

  expect(events.some((e) => e.type === "approval_request")).toBe(false);
  expect(asked).toBe(false);
  const tool = result.find((m) => m.role === "tool");
  expect(tool?.toolResult?.success).toBe(true);
  expect(tool?.toolResult?.output).toContain("auto-ran");

  server.stop(true);
});
