import { nanoid } from "nanoid";
import type { ApprovalRequest, Message, ToolCall, ToolDefinition, Usage } from "@/core/types";
import type { Provider, StreamRequest } from "@/providers";
import { logger } from "@/utils/logger";
import { ToolRegistry } from "./tool-registry";

export type AgentEvent =
  | { type: "turn_start" }
  | { type: "thought"; content: string }
  | { type: "content"; content: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_result"; message: Message }
  | { type: "approval_request"; request: ApprovalRequest }
  | { type: "status"; status: string }
  | { type: "usage"; usage: Usage }
  | { type: "error"; error: string }
  | { type: "done" };

export interface AgentRunOptions {
  messages: Message[];
  provider: Provider;
  model: string;
  systemPrompt: string;
  workingDir: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: { enabled: boolean; effort: "low" | "medium" | "high" };
  autoApproveSafeTools: boolean;
  /** Approve every tool call without asking (writes, shell, scans). */
  autoApproveAll?: boolean;
  maxTurns?: number;
  /** Tool subset to offer (defaults to every tool). */
  tools?: ToolDefinition[];
  onEvent: (event: AgentEvent) => void;
  onApproval: (request: ApprovalRequest) => Promise<boolean>;
}

export class AgentLoop {
  private registry: ToolRegistry;

  constructor(tools?: ToolDefinition[]) {
    this.registry = new ToolRegistry(tools);
  }

  async run(options: AgentRunOptions): Promise<Message[]> {
    const conversation: Message[] = [...options.messages];
    const maxTurns = options.maxTurns ?? 40;
    const registry = options.tools ? new ToolRegistry(options.tools) : this.registry;

    for (let turn = 0; turn < maxTurns; turn++) {
      options.onEvent({ type: "turn_start" });

      let thinking = "";
      let content = "";
      const toolCalls: ToolCall[] = [];

      const req: StreamRequest = {
        messages: conversation,
        tools: registry.getAll(),
        model: options.model,
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        reasoning: options.reasoning,
      };

      for await (const evt of options.provider.stream(req)) {
        switch (evt.type) {
          case "thought":
            thinking += evt.content;
            options.onEvent(evt);
            break;
          case "content":
            content += evt.content;
            options.onEvent(evt);
            break;
          case "tool_call":
            toolCalls.push(evt.toolCall);
            options.onEvent(evt);
            break;
          case "usage":
            options.onEvent(evt);
            break;
          case "notice":
            options.onEvent({ type: "status", status: evt.message });
            break;
          case "error":
            options.onEvent(evt);
            conversation.push({
              id: nanoid(),
              role: "assistant",
              content: `⚠️ ${evt.error}`,
              timestamp: Date.now(),
              done: true,
            });
            return conversation;
          case "done":
            break;
        }
      }

      if (content.trim() || thinking.trim() || toolCalls.length === 0) {
        conversation.push({
          id: nanoid(),
          role: "assistant",
          content,
          thinking: thinking || undefined,
          timestamp: Date.now(),
          done: true,
        });
      }

      if (toolCalls.length === 0) {
        options.onEvent({ type: "done" });
        return conversation;
      }

      for (const call of toolCalls) {
        const def = registry.get(call.name);

        conversation.push({
          id: nanoid(),
          role: "assistant",
          // The text lives on the single assistant message above; repeating it here
          // renders it once per tool call and duplicates it on the wire.
          content: "",
          toolCallId: call.id,
          toolName: call.name,
          toolArgs: call.args,
          timestamp: Date.now(),
          done: true,
        });

        if (!def) {
          const available = registry
            .getAll()
            .map((t) => t.name)
            .join(", ");
          const msg = toolMessage(
            call,
            `ERROR: unknown tool "${call.name}". Available tools: ${available}. Call one of those instead.`,
          );
          conversation.push(msg);
          options.onEvent({ type: "tool_result", message: msg });
          continue;
        }

        const approved = await this.requestApproval(call, def, options);
        if (!approved) {
          const msg = toolMessage(
            call,
            "ERROR: the user denied this tool call. Ask how they would like to proceed.",
          );
          conversation.push(msg);
          options.onEvent({ type: "tool_result", message: msg });
          continue;
        }

        const result = await registry.execute(
          call.id,
          call.name,
          call.args,
          options.workingDir,
        );

        const msg: Message = {
          id: nanoid(),
          role: "tool",
          content: "",
          timestamp: Date.now(),
          toolCallId: call.id,
          toolName: call.name,
          toolResult: result,
        };
        conversation.push(msg);
        options.onEvent({ type: "tool_result", message: msg });
      }
    }

    conversation.push({
      id: nanoid(),
      role: "assistant",
      content: `Stopped: reached the maximum of ${maxTurns} turns.`,
      timestamp: Date.now(),
      done: true,
    });
    options.onEvent({ type: "error", error: `Reached max turns (${maxTurns}).` });
    return conversation;
  }

  private async requestApproval(
    call: ToolCall,
    def: { name: string; needsApproval?: boolean; safe?: boolean },
    options: AgentRunOptions,
  ): Promise<boolean> {
    if (!def.needsApproval) return true;
    if (options.autoApproveAll) return true;
    if (def.safe && options.autoApproveSafeTools) return true;

    const request: ApprovalRequest = {
      id: call.id,
      toolName: call.name,
      args: call.args,
      dangerous: call.name === "run_bash" || call.name === "port_scan",
      description: describeTool(call),
    };

    options.onEvent({ type: "approval_request", request });
    try {
      return await options.onApproval(request);
    } catch (e) {
      logger.error("Approval handler failed", e);
      return false;
    }
  }
}

function toolMessage(call: ToolCall, content: string): Message {
  return {
    id: nanoid(),
    role: "tool",
    content,
    timestamp: Date.now(),
    toolCallId: call.id,
    toolName: call.name,
    toolResult: { success: false, error: content },
  };
}

function describeTool(call: ToolCall): string {
  const a = call.args as Record<string, unknown>;
  switch (call.name) {
    case "read_file":
      return `Read ${a.path}`;
    case "list_dir":
      return `List ${a.path ?? "."}`;
    case "glob":
      return `Find ${a.pattern}`;
    case "write_file":
      return `Write ${a.path} (${String(a.content ?? "").length} chars)`;
    case "edit_file":
      return `Edit ${a.path}`;
    case "run_bash":
      return `Run: ${a.command}`;
    case "http_request":
      return `${String(a.method ?? "GET").toUpperCase()} ${a.url}`;
    case "port_scan":
      return `Scan ${a.host} (${a.ports ?? "common ports"})`;
    default:
      return `Call ${call.name}`;
  }
}
