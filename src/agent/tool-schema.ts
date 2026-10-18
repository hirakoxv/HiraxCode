import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDefinition } from "@/core/types";

export interface JsonSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/** Convert a tool's zod schema into a plain JSON schema. */
export function toolJsonSchema(tool: ToolDefinition): JsonSchema {
  try {
    const schema = zodToJsonSchema(tool.parameters as never, {
      $refStrategy: "none",
    }) as JsonSchema;
    delete (schema as Record<string, unknown>).$schema;
    return schema;
  } catch {
    return { type: "object", properties: {} };
  }
}

export function toToolSchemas(tools: ToolDefinition[]): ToolSchema[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toolJsonSchema(t),
  }));
}

/**
 * Google's `functionDeclarations.parameters` uses a restricted Schema proto.
 * It rejects `additionalProperties`, `$schema`, `$ref`, etc., and cannot handle
 * a `type` that is a list (e.g. `["number", "null"]` from optional zod fields).
 * This converts a JSON schema into something Gemini accepts.
 */
export function sanitizeForGemini(input: unknown): JsonSchema {
  if (!input || typeof input !== "object") return { type: "object", properties: {} };
  let src = input as Record<string, unknown>;

  // Collapse `anyOf: [X, {type:"null"}]` (or the reverse) into X + nullable:true.
  if (Array.isArray(src.anyOf)) {
    const branches = src.anyOf as Record<string, unknown>[];
    const nonNull = branches.filter((b) => !(b && b.type === "null"));
    const hasNull = branches.some((b) => b && b.type === "null");
    if (hasNull && nonNull.length === 1) {
      src = { ...nonNull[0], description: src.description ?? nonNull[0]!.description, nullable: true };
    }
  }

  const out: Record<string, unknown> = {};

  let type = src.type;
  let nullable = src.nullable === true;

  if (Array.isArray(type)) {
    if (type.includes("null")) nullable = true;
    const rest = type.filter((t) => t !== "null");
    type = rest.length === 1 ? rest[0] : rest.length > 1 ? "object" : undefined;
  }
  if (typeof type === "string" && type !== "null") out.type = type;

  for (const key of ["description", "format", "title", "pattern", "example"]) {
    if (key in src && src[key] != null) out[key] = src[key];
  }
  for (const key of [
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
  ]) {
    if (key in src && src[key] != null) out[key] = src[key];
  }

  if (Array.isArray(src.enum)) out.enum = src.enum;
  if (nullable) out.nullable = true;

  if (src.properties && typeof src.properties === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src.properties as Record<string, unknown>)) {
      props[k] = sanitizeForGemini(v);
    }
    out.properties = props;
  }

  if (Array.isArray(src.required)) out.required = src.required;

  if (src.items) out.items = sanitizeForGemini(src.items);

  if (Array.isArray(src.anyOf)) out.anyOf = src.anyOf.map(sanitizeForGemini);

  // Gemini requires `items` for arrays and `properties` for objects.
  if (out.type === "array" && !out.items) out.items = { type: "string" };
  if (out.type === "object" && !out.properties) out.properties = {};

  return out as JsonSchema;
}

export function toGeminiTools(tools: ToolDefinition[]) {
  return toToolSchemas(tools).map((t) => ({
    name: t.name,
    description: t.description || "",
    parameters: sanitizeForGemini(t.parameters),
  }));
}

/** OpenAI / OpenRouter function-calling format. */
export function toOpenAiTools(tools: ToolDefinition[]) {
  return toToolSchemas(tools).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
