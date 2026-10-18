import type { ToolDefinition, ToolResult, ToolResultPayload } from "@/core/types";
import { executeTool, allTools } from "./tools";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = allTools) {
    for (const t of tools) this.tools.set(t.name, t);
  }

  getAll(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  isSafe(name: string): boolean {
    return this.tools.get(name)?.safe === true;
  }

  needsApproval(name: string): boolean {
    return this.tools.get(name)?.needsApproval === true;
  }

  async execute(
    callId: string,
    name: string,
    args: Record<string, unknown>,
    cwd: string,
  ): Promise<ToolResult> {
    const payload: ToolResultPayload = await executeTool(name, args, cwd);
    return {
      toolCallId: callId,
      name,
      success: payload.success,
      output: payload.output,
      error: payload.error,
    };
  }
}
