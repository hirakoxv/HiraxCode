import { getProvider, modelInfo } from "./providers";

/**
 * Model-name patterns for known vision-capable models. Used for providers that
 * mix text-only and multimodal models (OpenAI-compatible endpoints, Ollama,
 * LM Studio, llama.cpp, OpenRouter, …).
 */
const VISION_PATTERNS: RegExp[] = [
  /gpt-4o/i,
  /gpt-4\.1/i,
  /gpt-4-turbo/i,
  /gpt-5/i,
  /^o3/i,
  /^o4/i,
  /claude/i,
  /gemini/i,
  /grok-[2-9]/i,
  /llava/i,
  /vision/i,
  /moondream/i,
  /pixtral/i,
  /internvl/i,
  /minicpm/i,
  /idefics/i,
  /cogvlm/i,
  /glm-4v/i,
  /deepseek-vl/i,
  /smolvlm/i,
  /llama-3\.2.*vision/i,
  /gemma-3/i,
  /phi-3\.5-vision/i,
  /phi-4-multimodal/i,
  /(^|[/\-_])vl([/\-_]|$)/i,
  /qwen2-vl/i,
  /qwen2\.5-vl/i,
  /qwen3-vl/i,
  /qwen-vl/i,
];

/** Human-friendly suggestions shown when a model cannot read images. */
export const VISION_EXAMPLES: Record<string, string> = {
  openai: "/model gpt-4.1 (or gpt-4o)",
  openrouter: "/model openai/gpt-4.1 or google/gemini-2.5-pro",
  anthropic: "/model claude-sonnet-4-5",
  google: "/model gemini-flash-latest",
  xai: "/model grok-4",
  ollama: "ollama pull llava  →  /model llava",
  lmstudio: "load an LLaVA/Qwen2-VL model in LM Studio",
  llamacpp: "start llama.cpp with a vision model + --mmproj",
  gguf: "set an “mmproj” file in /settings, or use a vision GGUF (e.g. llava)",
};

/**
 * Best-effort check whether `model` on `providerId` accepts image input.
 * `opts.mmproj` marks a GGUF server that was launched with a multimodal
 * projector (llama.cpp `--mmproj`), which enables vision for local files.
 */
export function supportsVision(
  providerId: string,
  model: string,
  opts?: { mmproj?: boolean },
): boolean {
  const def = getProvider(providerId);

  if (def?.id === "gguf" || providerId === "gguf") return !!opts?.mmproj;

  // The models.dev catalog knows exactly which models accept images.
  if (model) {
    const info = modelInfo(providerId, model);
    if (info && info.attachment !== undefined) return info.attachment;
  }

  if (def?.kind === "gemini") return true;
  if (def?.kind === "anthropic") return /claude/i.test(model) || model === "";
  if (!model) return false;

  return VISION_PATTERNS.some((re) => re.test(model));
}

/** A short hint telling the user how to get image support for a provider. */
export function visionHint(providerId: string): string {
  return VISION_EXAMPLES[providerId] ?? "switch to a vision model with /model";
}
