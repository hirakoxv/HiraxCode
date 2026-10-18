import type { Message } from "@/core/types";
import { toGeminiTools } from "@/agent/tool-schema";
import { logger } from "@/utils/logger";
import { readSSE, formatApiError, fetchWithRetry, isKeyRotationStatus, type Provider, type StreamEvent, type StreamRequest } from "./types";

export interface GeminiProviderOptions {
  baseUrl: string;
  apiKey?: string;
  /** Multiple keys, tried in order when one is rejected. Overrides `apiKey`. */
  apiKeys?: string[];
}

type Part =
  | { text: string; thought?: boolean }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

interface GeminiContent {
  role: "user" | "model";
  parts: Part[];
}

/** Convert internal transcript to Gemini generateContent format. */
export function toGeminiContents(messages: Message[]): GeminiContent[] {
  const out: GeminiContent[] = [];

  const push = (role: "user" | "model", parts: Part[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  };

  for (const m of messages) {
    if (m.role === "system") continue;

    if (m.role === "user") {
      const parts: Part[] = [];
      if (m.content.trim()) parts.push({ text: m.content });
      for (const img of m.images ?? []) {
        parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
      }
      if (parts.length === 0) parts.push({ text: m.content });
      push("user", parts);
      continue;
    }

    if (m.role === "assistant") {
      if (m.toolName) {
        push("model", [{ functionCall: { name: m.toolName, args: m.toolArgs ?? {} } }]);
      } else if (m.content) {
        push("model", [{ text: m.content }]);
      }
      continue;
    }

    if (m.role === "tool") {
      const r = m.toolResult;
      const response = r
        ? r.success
          ? { result: r.output || "(done)" }
          : { error: r.error || "failed" }
        : { result: m.content };
      push("user", [{ functionResponse: { name: m.toolName ?? "tool", response } }]);
      continue;
    }
  }

  return out;
}

export class GeminiProvider implements Provider {
  readonly kind = "gemini" as const;
  readonly id = "google";

  constructor(private opts: GeminiProviderOptions) {}

  /** Keys to try, in order (explicit list, else the single key). */
  private keyList(): string[] {
    const list = (this.opts.apiKeys ?? []).map((k) => k.trim()).filter(Boolean);
    if (list.length > 0) return list;
    return this.opts.apiKey?.trim() ? [this.opts.apiKey.trim()] : [];
  }

  async *stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
    const keys = this.keyList();
    if (keys.length === 0) {
      yield { type: "error", error: "No Gemini API key set. Open settings (/settings)." };
      return;
    }

    const body: Record<string, unknown> = {
      contents: toGeminiContents(req.messages),
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        ...(req.maxTokens && req.maxTokens > 0 ? { maxOutputTokens: req.maxTokens } : {}),
      },
    };

    if (req.systemPrompt) {
      body.systemInstruction = { parts: [{ text: req.systemPrompt }] };
    }

    if (req.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: toGeminiTools(req.tools),
        },
      ];
    }

    const payload = JSON.stringify(body);
    let res: Response | null = null;
    let errMsg = "";

    for (let i = 0; i < keys.length; i++) {
      const url =
        `${this.opts.baseUrl}/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent` +
        `?alt=sse&key=${encodeURIComponent(keys[i]!)}`;

      try {
        res = await fetchWithRetry(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
        });
      } catch (e) {
        yield { type: "error", error: `Cannot reach Gemini: ${(e as Error).message}` };
        return;
      }

      if (res.ok && res.body) break;

      const text = await res.text().catch(() => "");
      logger.error("gemini api error", res.status, text);
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

    let callIndex = 0;

    try {
      for await (const data of readSSE(streamBody)) {
        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        const meta = chunk.usageMetadata;
        if (meta) {
          yield {
            type: "usage",
            usage: {
              prompt: meta.promptTokenCount ?? 0,
              completion: meta.candidatesTokenCount ?? 0,
              total: meta.totalTokenCount ?? 0,
            },
          };
        }

        const parts: Part[] | undefined = chunk.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) continue;

        for (const part of parts) {
          if ("text" in part && part.text) {
            if (part.thought) yield { type: "thought", content: part.text };
            else yield { type: "content", content: part.text };
          } else if ("functionCall" in part && part.functionCall) {
            yield {
              type: "tool_call",
              toolCall: {
                id: `gemini_call_${++callIndex}_${Date.now()}`,
                name: part.functionCall.name,
                args: part.functionCall.args ?? {},
              },
            };
          }
        }
      }
      yield { type: "done" };
    } catch (err) {
      yield { type: "error", error: `Stream error: ${(err as Error).message}` };
    }
  }
}
