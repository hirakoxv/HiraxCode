import type { Message, ToolDefinition } from "@/core/types";
import { modelSupportsTemperature, modelSupportsToolCalls } from "@/core/providers";
import { toOpenAiTools } from "@/agent/tool-schema";
import { logger } from "@/utils/logger";
import {
  formatApiError,
  fetchWithRetry,
  isKeyRotationStatus,
  readSSE,
  safeParseJson,
  type Provider,
  type StreamEvent,
  type StreamRequest,
} from "./types";

export interface OpenAiProviderOptions {
  id: string;
  baseUrl: string;
  apiKey?: string;
  /** Multiple keys, tried in order when one is rejected. Overrides `apiKey`. */
  apiKeys?: string[];
  /**
   * Force the "API key required" check. Local endpoints normally skip it, but
   * some (e.g. the FreeLLMAPI router) live on localhost and still want a key.
   */
  requiresKey?: boolean;
  /** Extra headers (e.g. OpenRouter attribution). */
  headers?: Record<string, string>;
  /** Send `reasoning: { effort }` (OpenRouter style). */
  sendReasoningParam?: boolean;
  /** Send `reasoning_effort` (OpenAI style). */
  sendReasoningEffort?: boolean;
}

type WirePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type WireContent = string | WirePart[];

interface WireMessage {
  role: string;
  content: WireContent | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/** Build OpenAI content: a plain string, or a text + image_url array. */
export function toOpenAiUserContent(m: Message): WireContent {
  if (!m.images?.length) return m.content;
  const parts: WirePart[] = [];
  if (m.content.trim()) parts.push({ type: "text", text: m.content });
  for (const img of m.images) {
    parts.push({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${img.data}` },
    });
  }
  return parts;
}

/** Only OpenAI's reasoning-capable models accept the `reasoning_effort` field. */
export function supportsReasoningEffort(model: string): boolean {
  return /^(o1|o3|o4|gpt-5)/i.test(model);
}

export function toOpenAiMessages(
  messages: Message[],
  systemPrompt?: string,
): WireMessage[] {
  const out: WireMessage[] = [];

  if (systemPrompt) out.push({ role: "system", content: systemPrompt });

  let pendingToolCalls: NonNullable<WireMessage["tool_calls"]> = [];
  let pendingContent: string | null = null;
  const flush = () => {
    if (pendingToolCalls.length === 0) return;
    out.push({ role: "assistant", content: pendingContent, tool_calls: pendingToolCalls });
    pendingToolCalls = [];
    pendingContent = null;
  };

  for (const m of messages) {
    if (m.role === "user" || m.role === "system") {
      flush();
      out.push({
        role: m.role,
        content: m.role === "user" ? toOpenAiUserContent(m) : m.content,
      });
      continue;
    }

    if (m.role === "assistant") {
      if (m.toolName && m.toolCallId) {
        if (m.content && pendingToolCalls.length === 0) pendingContent = m.content;
        pendingToolCalls.push({
          id: m.toolCallId,
          type: "function",
          function: { name: m.toolName, arguments: JSON.stringify(m.toolArgs ?? {}) },
        });
        continue;
      }
      flush();
      if (m.content) out.push({ role: "assistant", content: m.content });
      continue;
    }

    if (m.role === "tool") {
      flush();
      const r = m.toolResult;
      const content = r
        ? r.success
          ? r.output || "(done)"
          : `ERROR: ${r.error || "failed"}`
        : m.content;
      out.push({ role: "tool", tool_call_id: m.toolCallId, content });
      continue;
    }
  }

  flush();
  return out;
}

/** Actionable error for a base URL that answers with a web page instead of a stream. */
function htmlEndpointError(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const hint = /\/v\d+\b/.test(trimmed)
    ? "check the Base URL in /settings (it should point at the provider's API root)."
    : `the Base URL is probably missing its path — try adding /v1 (e.g. ${trimmed}/v1).`;
  return `${trimmed}/chat/completions returned an HTML page instead of an API stream — ${hint}`;
}

export class OpenAiProvider implements Provider {
  readonly kind = "openai" as const;
  readonly id: string;

  constructor(private opts: OpenAiProviderOptions) {
    this.id = opts.id;
  }

  /** Keys to try, in order (explicit list, else the single key). */
  private keyList(): string[] {
    const list = (this.opts.apiKeys ?? []).map((k) => k.trim()).filter(Boolean);
    if (list.length > 0) return list;
    return this.opts.apiKey?.trim() ? [this.opts.apiKey.trim()] : [];
  }

  async *stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
    if (!this.opts.baseUrl) {
      yield {
        type: "error",
        error: `No base URL for ${this.id}. Set one in /settings (the provider needs an endpoint).`,
      };
      return;
    }

    const keys = this.keyList();
    if (keys.length === 0 && this.needsKey()) {
      yield { type: "error", error: `No API key set for ${this.id}. Open settings (/settings).` };
      return;
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAiMessages(req.messages, req.systemPrompt),
      stream: true,
    };

    // Some reasoning models reject `temperature`; the catalog tells us.
    if (modelSupportsTemperature(this.id, req.model)) {
      body.temperature = req.temperature ?? 0.2;
    }

    if (req.maxTokens && req.maxTokens > 0) {
      // OpenAI's reasoning models want `max_completion_tokens`.
      if (this.id === "openai" && /^(o1|o3|o4|gpt-5)/i.test(req.model)) {
        body.max_completion_tokens = req.maxTokens;
      } else {
        body.max_tokens = req.maxTokens;
      }
    }

    if (req.tools.length > 0 && modelSupportsToolCalls(this.id, req.model)) {
      body.tools = toOpenAiTools(req.tools);
      body.tool_choice = "auto";
    }

    if (req.reasoning?.enabled) {
      // `reasoning` is OpenRouter's generic field — safe for any model.
      if (this.opts.sendReasoningParam) {
        body.reasoning = { effort: req.reasoning.effort };
      }
      // OpenAI only accepts `reasoning_effort` on reasoning models.
      if (this.opts.sendReasoningEffort && supportsReasoningEffort(req.model)) {
        body.reasoning_effort = req.reasoning.effort;
      }
    }

    const candidates = keys.length > 0 ? keys : [""]; // local endpoints need no key
    const payload = JSON.stringify(body);
    let res: Response | null = null;
    let errMsg = "";

    for (let i = 0; i < candidates.length; i++) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(candidates[i] ? { Authorization: `Bearer ${candidates[i]}` } : {}),
        ...(this.opts.headers ?? {}),
      };

      try {
        res = await fetchWithRetry(`${this.opts.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: payload,
        });
      } catch (e) {
        yield { type: "error", error: `Cannot reach ${this.opts.baseUrl}: ${(e as Error).message}` };
        return;
      }

      if (res.ok && res.body) {
        // A dashboard/SPA or generic web server answers unknown paths with an
        // HTML page and 200 OK. Without this check we'd stream HTML, find no
        // SSE events, and silently return an empty reply.
        const ctype = res.headers.get("content-type") ?? "";
        if (ctype.includes("text/html")) {
          yield { type: "error", error: htmlEndpointError(this.opts.baseUrl) };
          return;
        }
        break;
      }

      const text = await res.text().catch(() => "");
      logger.error("openai api error", res.status, text);
      errMsg = formatApiError(res.status, text);

      if (i < candidates.length - 1 && isKeyRotationStatus(res.status)) {
        yield {
          type: "notice",
          message: `API key ${i + 1}/${candidates.length} rejected (${res.status}) — rotating to key ${i + 2}`,
        };
        continue;
      }
      break;
    }

    if (!res || !res.ok || !res.body) {
      yield { type: "error", error: errMsg || "request failed" };
      return;
    }

    const streamBody = res.body;
    let received = 0;

    let toolId: string | null = null;
    let toolName = "";
    let toolArgs = "";

    const emitTool = (): StreamEvent | null => {
      if (!toolId || !toolName) return null;
      const evt: StreamEvent = {
        type: "tool_call",
        toolCall: { id: toolId, name: toolName, args: safeParseJson(toolArgs) },
      };
      toolId = null;
      toolName = "";
      toolArgs = "";
      return evt;
    };

    try {
      for await (const data of readSSE(streamBody)) {
        received++;
        if (data === "[DONE]") {
          const e = emitTool();
          if (e) yield e;
          yield { type: "done" };
          return;
        }

        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        if (chunk.usage) {
          yield {
            type: "usage",
            usage: {
              prompt: chunk.usage.prompt_tokens ?? 0,
              completion: chunk.usage.completion_tokens ?? 0,
              total: chunk.usage.total_tokens ?? 0,
            },
          };
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};

        const reasoning = delta.reasoning ?? delta.reasoning_content;
        if (typeof reasoning === "string" && reasoning) {
          yield { type: "thought", content: reasoning };
        }
        if (typeof delta.content === "string" && delta.content) {
          yield { type: "content", content: delta.content };
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
              const e = emitTool();
              if (e) yield e;
              toolId = tc.id;
              toolName = tc.function?.name ?? "";
              toolArgs = tc.function?.arguments ?? "";
            } else {
              if (tc.function?.name) toolName += tc.function.name;
              if (tc.function?.arguments) toolArgs += tc.function.arguments;
            }
          }
        }

        if (choice.finish_reason === "tool_calls") {
          const e = emitTool();
          if (e) yield e;
        } else if (choice.finish_reason === "stop") {
          yield { type: "done" };
          return;
        }
      }

      const e = emitTool();
      if (e) yield e;

      // The stream ended without a single event: almost always a wrong base
      // URL (missing /v1) or a model the endpoint doesn't serve.
      if (received === 0) {
        yield {
          type: "error",
          error:
            `No data received from ${this.opts.baseUrl}/chat/completions. ` +
            `Check the Base URL points at the OpenAI-compatible path (often ending in /v1) ` +
            `and that the model "${req.model}" exists (run /model to list them).`,
        };
        return;
      }

      yield { type: "done" };
    } catch (err) {
      yield { type: "error", error: `Stream error: ${(err as Error).message}` };
    }
  }

  private needsKey(): boolean {
    // An explicit provider definition wins (e.g. a local router that still
    // requires a unified key).
    if (this.opts.requiresKey !== undefined) return this.opts.requiresKey;
    // Local endpoints accept any/no key.
    return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(this.opts.baseUrl)
      ? false
      : true;
  }
}
