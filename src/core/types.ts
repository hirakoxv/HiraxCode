/** Shared types for HiraxCode. */

export type Role = "user" | "assistant" | "tool" | "system";

export interface ToolResultPayload {
  success: boolean;
  output?: string;
  error?: string;
}

/** An image attached to a message (base64, no data: prefix). */
export interface MessageImage {
  /** MIME type, e.g. "image/png". */
  mime: string;
  /** Base64-encoded bytes. */
  data: string;
  /** Optional display name (e.g. "clipboard.png"). */
  name?: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  /** Images attached to this message (user screenshots, etc.). */
  images?: MessageImage[];
  /** Tool call metadata (assistant message that requested a tool) */
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  /** Result payload (tool message) */
  toolResult?: ToolResultPayload;
  /** Model reasoning / thinking trace */
  thinking?: string;
  isStreaming?: boolean;
  done?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** Zod object schema describing the parameters */
  parameters: unknown;
  /** Requires explicit user approval before execution */
  needsApproval?: boolean;
  /** Read-only tools are safe to auto-approve */
  safe?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  success: boolean;
  output?: string;
  error?: string;
}

export interface Usage {
  prompt: number;
  completion: number
  total: number;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  model: string;
  workingDir: string;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  description: string;
  args: Record<string, unknown>;
  dangerous: boolean;
}

export type AgentStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "tool_call"
  | "error";
