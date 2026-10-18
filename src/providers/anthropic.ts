import type { Message } from "@/core/types";
import { toToolSchemas } from "@/agent/tool-schema";
import { logger } from "@/utils/logger";
import { readSSE, safeParseJson, formatApiError, fetchWithRetry, isKeyRotationStatus, type Provider, type StreamEvent, type StreamRequest } from "./types";

export interface AnthropicProviderOptions {
  baseUrl: string;
  apiKey?: string;
  /** Multiple keys, tried in order when one is rejected. Overrides `apiKey`. */
  apiKeys?: string[];
}

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: Block[];
}

const EFFORT_BUDGET: Record<string, number> = { low: 2048, medium: 8192, high: 16384 };

/**
 * Extended thinking is available on Claude 3.7+ and the Claude 4.x families.
 * Anchored on the version token so a dated 3.x id like `claude-3-5-sonnet-20240620`
 * is not mistaken for a 4.x model just because its date contains a 4.
 */
export function supportsThinking(model: string): boolean {
  const id = model.toLowerCase();
  if (/claude-3[.-]7/.test(id)) return true;
  return /claude-(?:[a-z]+-)?4(?:[.-]\d+)?(?![0-9])/.test(id);
}

/** Convert internal transcript to Anthropic Messages format. */
export function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];

  const push = (role: "user" | "assistant", blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content.push(...blocks);
    } else {
      out.push({ role, content: blocks });
    }
  };

  for (const m of messages) {
    if (m.role === "system") continue;

    if (m.role === "user") {
      const blocks: Block[] = [];
      if (m.content.trim()) blocks.push({ type: "text", text: m.content });
      for (const img of m.images ?? []) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: img.mime, data: img.data },
        });
      }
      push("user", blocks);
      continue;
    }

    if (m.role === "assistant") {
      const blocks: Block[] = [];
      if (m.toolName && m.toolCallId) {
        blocks.push({
          type: "tool_use",
          id: m.toolCallId,
          name: m.toolName,
          input: m.toolArgs ?? {},
        });
      } else if (m.content) {
        blocks.push({ type: "text", text: m.content });
      }
      if (blocks.length) push("assistant", blocks);
      continue;
    }

    if (m.role === "tool") {
      const r = m.toolResult;
      const content = r
        ? r.success
          ? r.output || "(done)"
          : `ERROR: ${r.error || "failed"}`
        : m.content;
      push("user", [
        { type: "tool_result", tool_use_id: m.toolCallId ?? "", content },
      ]);
      continue;
    }
  }

  return out;
}

export class AnthropicProvider implements Provider {
  readonly kind = "anthropic" as const;
  readonly id = "anthropic";

  constructor(private opts: AnthropicProviderOptions) {}

  /** Keys to try, in order (explicit list, else the single key). */
  private keyList(): string[] {
    const list = (this.opts.apiKeys ?? []).map((k) => k.trim()).filter(Boolean);
    if (list.length > 0) return list;
    return this.opts.apiKey?.trim() ? [this.opts.apiKey.trim()] : [];
  }

  async *stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
    const keys = this.keyList();
    if (keys.length === 0) {
      yield { type: "error", error: "No Anthropic API key set. Open settings (/settings)." };
      return;
    }

    const thinkingEnabled =
      (req.reasoning?.enabled ?? false) && supportsThinking(req.model);
    const budget = EFFORT_BUDGET[req.reasoning?.effort ?? "medium"] ?? 8192;
    const maxTokens = Math.max(req.maxTokens && req.maxTokens > 0 ? req.maxTokens : 8192, thinkingEnabled ? budget + 2048 : 1024);

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: maxTokens,
      messages: toAnthropicMessages(req.messages),
      stream: true,
    };

    if (req.systemPrompt) body.system = req.systemPrompt;
    // Extended thinking requires temperature to be unset.
    if (req.temperature != null && !thinkingEnabled) body.temperature = Math.min(req.temperature, 1);

    if (req.tools.length > 0) {
      body.tools = toToolSchemas(req.tools).map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    if (thinkingEnabled) {
      body.thinking = { type: "enabled", budget_tokens: budget };
    }

    const payload = JSON.stringify(body);
    let res: Response | null = null;
    let errMsg = "";

    for (let i = 0; i < keys.length; i++) {
      try {
        res = await fetchWithRetry(`${this.opts.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": keys[i]!,
            "anthropic-version": "2023-06-01",
          },
          body: payload,
        });
      } catch (e) {
        yield { type: "error", error: `Cannot reach Anthropic: ${(e as Error).message}` };
        return;
      }

      if (res.ok && res.body) break;

      const text = await res.text().catch(() => "");
      logger.error("anthropic api error", res.status, text);
      errMsg = formatApiError(res.status, text);

      if (i < keys.length - 1 && isKeyRotationStatus(res.status)) {
        yield {
          type: "notice",
          message: `API key ${i + 1}/${keys.length} rejected (${res.status}) — rotating to key ${i + 2}`,
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

    // Track the tool_use block currently being streamed.
    let currentTool: { id: string; name: string; json: string } | null = null;

    try {
      for await (const data of readSSE(streamBody)) {
        let evt: any;
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }

        switch (evt.type) {
          case "message_start": {
            const u = evt.message?.usage;
            if (u) {
              yield {
                type: "usage",
                usage: {
                  prompt: u.input_tokens ?? 0,
                  completion: u.output_tokens ?? 0,
                  total: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
                },
              };
            }
            break;
          }
          case "content_block_start": {
            const block = evt.content_block;
            if (block?.type === "tool_use") {
              currentTool = { id: block.id, name: block.name, json: "" };
            } else if (block?.type === "text" && block.text) {
              yield { type: "content", content: block.text };
            }
            break;
          }
          case "content_block_delta": {
            const d = evt.delta;
            if (d?.type === "text_delta" && d.text) {
              yield { type: "content", content: d.text };
            } else if (d?.type === "thinking_delta" && d.thinking) {
              yield { type: "thought", content: d.thinking };
            } else if (d?.type === "input_json_delta" && currentTool) {
              currentTool.json += d.partial_json ?? "";
            }
            break;
          }
          case "content_block_stop": {
            if (currentTool) {
              yield {
                type: "tool_call",
                toolCall: {
                  id: currentTool.id,
                  name: currentTool.name,
                  args: safeParseJson(currentTool.json),
                },
              };
              currentTool = null;
            }
            break;
          }
          case "message_delta": {
            const u = evt.usage;
            if (u) {
              // Only the completion count is authoritative here. `message_start` already
              // reported input+output; sending a total now would replace it with output
              // only, because the UI merges with `evt.usage.total || previous.total`.
              yield {
                type: "usage",
                usage: {
                  prompt: 0,
                  completion: u.output_tokens ?? 0,
                  total: 0,
                },
              };
            }
            break;
          }
          case "message_stop": {
            yield { type: "done" };
            return;
          }
          case "error": {
            yield { type: "error", error: evt.error?.message ?? "Anthropic stream error" };
            return;
          }
        }
      }
      yield { type: "done" };
    } catch (err) {
      yield { type: "error", error: `Stream error: ${(err as Error).message}` };
    }
  }
}
