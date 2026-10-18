import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { CustomProvider } from "@/core/settings";
import type { ProviderKind } from "@/core/providers";
import { makeTheme, type Theme } from "../theme";
import { sanitizeInput } from "../lib/input";
import { truncate } from "../lib/text";

interface CustomProviderFormProps {
  accent: string;
  existing: CustomProvider[];
  onSubmit: (provider: CustomProvider) => void;
  onCancel: () => void;
  theme?: Theme;
  width?: number;
}

type Step = "id" | "name" | "baseUrl" | "kind" | "apiKey" | "models" | "review";

const STEPS: Step[] = ["id", "name", "baseUrl", "kind", "apiKey", "models", "review"];
const KINDS: ProviderKind[] = ["openai", "anthropic", "gemini"];

const PROMPTS: Record<Step, { label: string; placeholder: string; hint?: string }> = {
  id: { label: "Provider id", placeholder: "acme", hint: "lowercase, no spaces — used in config" },
  name: { label: "Display name", placeholder: "Acme AI" },
  baseUrl: {
    label: "Base URL",
    placeholder: "https://llm.acme.example/v1",
    hint: "OpenAI-compatible endpoints usually end with /v1",
  },
  kind: { label: "Wire protocol", placeholder: "openai", hint: "←→ openai / anthropic / gemini" },
  apiKey: { label: "API key (optional)", placeholder: "sk-…", hint: "leave empty to use an env var" },
  models: {
    label: "Models (optional)",
    placeholder: "coder-v2, coder-v1",
    hint: "comma-separated; add more later with /model",
  },
  review: { label: "Review", placeholder: "" },
};

export function CustomProviderForm({
  accent,
  existing,
  onSubmit,
  onCancel,
  theme,
  width = 80,
}: CustomProviderFormProps) {
  const t = theme ?? makeTheme(accent);
  const [step, setStep] = useState<Step>("id");
  const [values, setValues] = useState<Record<string, string>>({ kind: "openai" });
  const [buffer, setBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);

  const goNext = () => {
    if (step === "id") {
      const id = buffer.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      if (!id) {
        setError("id is required");
        return;
      }
      if (existing.some((c) => c.id === id)) {
        setError(`"${id}" already exists`);
        return;
      }
      if (RESERVED.has(id)) {
        setError(`"${id}" is a built-in provider id`);
        return;
      }
      values.id = id;
      setValues({ ...values });
      setBuffer("");
    } else if (step === "name") {
      values.name = buffer.trim() || values.id || "";
      setValues({ ...values });
      setBuffer("");
    } else if (step === "baseUrl") {
      const url = buffer.trim();
      if (!/^https?:\/\//i.test(url)) {
        setError("base URL must start with http:// or https://");
        return;
      }
      values.baseUrl = url.replace(/\/+$/, "");
      setValues({ ...values });
      setBuffer("");
    } else if (step === "apiKey") {
      values.apiKey = buffer.trim();
      setValues({ ...values });
      setBuffer("");
    } else if (step === "models") {
      values.models = buffer.trim();
      setValues({ ...values });
      setBuffer("");
    } else {
      onSubmit({
        id: values.id!,
        name: values.name || values.id!,
        kind: (values.kind as ProviderKind) || "openai",
        baseUrl: values.baseUrl!,
        models: (values.models ?? "")
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
      });
      return;
    }
    setError(null);
    const i = STEPS.indexOf(step);
    setStep(STEPS[Math.min(i + 1, STEPS.length - 1)]!);
  };

  const goBack = () => {
    setError(null);
    const i = STEPS.indexOf(step);
    if (i <= 0) {
      onCancel();
      return;
    }
    const prev = STEPS[i - 1]!;
    setStep(prev);
    setBuffer(values[prev] ?? "");
  };

  useInput((input, key) => {
    if (key.escape) {
      goBack();
      return;
    }
    if (step === "review") {
      if (key.return) goNext();
      return;
    }
    if (step === "kind") {
      if (key.leftArrow || key.rightArrow) {
        const i = KINDS.indexOf((values.kind as ProviderKind) ?? "openai");
        const dir = key.rightArrow ? 1 : -1;
        const next = KINDS[(i + dir + KINDS.length) % KINDS.length]!;
        setValues({ ...values, kind: next });
        return;
      }
      if (key.return) goNext();
      return;
    }
    if (key.return) {
      goNext();
      return;
    }
    if (key.backspace || key.delete) {
      setBuffer((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      const clean = sanitizeInput(input);
      if (clean) setBuffer((v) => v + clean);
    }
  });

  const idx = STEPS.indexOf(step);
  const shown = step === "review";
  const prompt = PROMPTS[step];
  const inner = Math.max(24, width - 8);

  // progress bar
  const barW = Math.max(7, Math.min(28, Math.floor(inner * 0.4)));
  const filled = Math.round(((idx + 1) / STEPS.length) * barW);
  const bar = "█".repeat(filled) + "░".repeat(barW - filled);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width="100%">
      <Box justifyContent="space-between" width="100%">
        <Text bold color={t.accent}>
          {"✦ "}Add custom provider
        </Text>
        <Text color={t.muted}>
          step {idx + 1}/{STEPS.length}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={t.accent}>{bar}</Text>
        <Text color={t.muted}>{`  ${prompt.label}`}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Summary label="id" value={values.id} t={t} />
        <Summary label="name" value={values.name} t={t} />
        <Summary label="base" value={values.baseUrl} t={t} />
        <Summary label="wire" value={values.kind ?? "openai"} t={t} />
        <Summary label="key" value={values.apiKey ? "••••••" : "(none)"} t={t} />
        <Summary label="models" value={values.models || "(add later with /model)"} t={t} />
      </Box>

      {!shown && (
        <>
          <Box marginTop={1} borderStyle="round" borderColor={t.borderActive} paddingX={1} width={inner}>
            <Text color={buffer ? t.text : t.muted}>
              {truncate(buffer || prompt.placeholder, inner - 4)}
            </Text>
            <Text color={t.accent} bold>
              ▌
            </Text>
          </Box>
          {prompt.hint && (
            <Box marginTop={1}>
              <Text color={t.muted} dimColor>
                {prompt.hint}
              </Text>
            </Box>
          )}
        </>
      )}

      {shown && (
        <Box marginTop={1}>
          <Text color={t.success}>press enter to save this provider</Text>
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color={t.danger}>⚠ {error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={t.muted}>
          {step === "kind" ? (
            <>
              <Text color={t.textDim}>←→</Text> choose ·{" "}
            </>
          ) : null}
          <Text color={t.textDim}>enter</Text> next · <Text color={t.textDim}>esc</Text> back
        </Text>
      </Box>
    </Box>
  );
}

function Summary({ label, value, t }: { label: string; value?: string; t: Theme }) {
  const shown = value ?? "—";
  return (
    <Text>
      <Text color={t.muted}>{label.padEnd(8)}</Text>
      <Text color={value ? t.textDim : t.muted}>{truncate(shown, 60)}</Text>
    </Text>
  );
}

const RESERVED = new Set([
  "openrouter",
  "openai",
  "anthropic",
  "google",
  "groq",
  "deepseek",
  "mistral",
  "xai",
  "together",
  "fireworks",
  "cerebras",
  "ollama",
  "lmstudio",
  "llamacpp",
  "gguf",
  "custom",
]);
