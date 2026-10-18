import type { Message, ToolCall, ToolDefinition, Usage } from "@/core/types";

export type StreamEvent =
  | { type: "thought"; content: string }
  | { type: "content"; content: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; usage: Usage }
  | { type: "notice"; message: string }
  | { type: "done" }
  | { type: "error"; error: string };

export interface StreamRequest {
  messages: Message[];
  tools: ToolDefinition[];
  model: string;
  systemPrompt: string;
  maxTokens?: number;
  temperature?: number;
  reasoning?: { enabled: boolean; effort: "low" | "medium" | "high" };
}

export interface Provider {
  readonly id: string;
  readonly kind: "openai" | "anthropic" | "gemini";
  stream(req: StreamRequest): AsyncGenerator<StreamEvent>;
}

/** Read a fetch Response body as a stream of SSE `data:` payloads. */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      yield trimmed.slice(5).trim();
    }
  }
}

export function safeParseJson(s: string): Record<string, unknown> {
  const trimmed = s.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Statuses that mean this particular API key is unusable — rotate to the next. */
const KEY_ROTATION_STATUS = new Set([401, 402, 403, 429]);

export function isKeyRotationStatus(status: number): boolean {
  return KEY_ROTATION_STATUS.has(status);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with retries for transient failures (rate limits, 5xx "high demand").
 * Only the connection is retried — the response body is never partially read
 * here, so it is safe to call before streaming.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (RETRYABLE_STATUS.has(res.status) && attempt < attempts - 1) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      if (attempt < attempts - 1) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

/**
 * Turn a raw error body into a short, readable message. Providers wrap errors
 * in JSON (`{error:{message}}`); unwrap it and add a hint for stale models.
 */
export function formatApiError(status: number, text: string): string {
  let message = text.trim();

  try {
    const json = JSON.parse(text) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const m = json.error?.message ?? json.message;
    if (typeof m === "string" && m.trim()) message = m.trim();
  } catch {
    // not JSON — keep the raw text
  }

  // Collapse whitespace so multi-line API messages stay readable in the TUI.
  message = message.replace(/\s+/g, " ").trim();

  if (status === 404) {
    message += /model/i.test(message)
      ? "  →  run /model to pick an available model"
      : "  →  check the model name (/model) and that the Base URL is the API path (often ending in /v1)";
  } else if (/no longer available|not found|deprecated/i.test(message) && /model/i.test(message)) {
    message += "  →  run /model to pick an available model";
  }

  return `API ${status}: ${message.slice(0, 400) || "request failed"}`;
}
