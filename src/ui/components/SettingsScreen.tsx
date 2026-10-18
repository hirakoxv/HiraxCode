import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { getProvider } from "@/core/providers";
import { ACCENTS, getApiKeys, maskKeys, resolveBaseUrl, TEMPERATURE_MAX, type Settings } from "@/core/settings";
import { makeTheme, type Theme } from "../theme";
import { padEnd, truncate } from "../lib/text";
import { TextField } from "./TextField";

interface SettingsScreenProps {
  settings: Settings;
  accent: string;
  onPatch: (patch: Partial<Settings>) => void;
  onPickProvider: () => void;
  onPickModel: () => void;
  onPickAgent: () => void;
  onClose: () => void;
  theme?: Theme;
  height?: number;
  width?: number;
}

type FieldId =
  | "provider"
  | "model"
  | "agent"
  | "apiKey"
  | "baseUrl"
  | "ggufPath"
  | "mmprojPath"
  | "llamaBin"
  | "llamaArgs"
  | "reasoning"
  | "temperature"
  | "maxTokens"
  | "autoApprove"
  | "autoApproveAll"
  | "workingDir"
  | "sidebar"
  | "minimal"
  | "compact"
  | "accent";

interface Field {
  id: FieldId;
  label: string;
  value: string;
  hint?: string;
}

export function SettingsScreen({
  settings,
  accent,
  onPatch,
  onPickProvider,
  onPickModel,
  onPickAgent,
  onClose,
  theme,
  height = 20,
  width = 80,
}: SettingsScreenProps) {
  const t = theme ?? makeTheme(accent);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState<FieldId | null>(null);

  const def = getProvider(settings.provider);
  const keys = getApiKeys(settings, settings.provider);

  const fields: Field[] = [
    { id: "provider", label: "Provider", value: def?.name ?? settings.provider, hint: "enter to change" },
    { id: "model", label: "Model", value: settings.model || "(none)", hint: "enter to pick" },
    { id: "agent", label: "Agent", value: settings.agent || "build", hint: "enter to pick" },
    ...(def?.needsKey !== false
      ? [
          {
            id: "apiKey" as FieldId,
            label: "API key(s)",
            value: maskKeys(keys),
            hint: "enter to set · comma-separate to rotate",
          },
        ]
      : []),
    {
      id: "baseUrl",
      label: "Base URL",
      value: resolveBaseUrl(settings, settings.provider),
      hint: "enter to edit",
    },
    ...(settings.provider === "gguf"
      ? ([
          { id: "ggufPath", label: "GGUF file", value: settings.ggufPath || "(not set)", hint: "enter to set" },
          { id: "mmprojPath", label: "mmproj (vision)", value: settings.mmprojPath || "(none)", hint: "enter to set" },
          { id: "llamaBin", label: "llama-server", value: settings.llamaServerBin || "llama-server", hint: "enter to set" },
          { id: "llamaArgs", label: "llama-server args", value: settings.llamaExtraArgs ?? "", hint: "enter to set" },
        ] as Field[])
      : []),
    {
      id: "reasoning",
      label: "Reasoning",
      value: `${settings.reasoning.enabled ? "on" : "off"} · ${settings.reasoning.effort}`,
      hint: "enter toggle · ←→ effort",
    },
    {
      id: "temperature",
      label: "Temperature",
      value: describeTemperature(settings.temperature),
      hint: "←→ · low = focused, high = creative",
    },
    {
      id: "maxTokens",
      label: "Max tokens",
      value: settings.maxTokens > 0 ? String(settings.maxTokens) : "0 (auto)",
      hint: "←→",
    },
    {
      id: "autoApprove",
      label: "Auto-approve safe tools",
      value: settings.autoApproveSafeTools ? "on" : "off",
      hint: "enter to toggle",
    },
    {
      id: "autoApproveAll",
      label: "Auto-approve everything",
      value: settings.autoApproveAll ? "on" : "off",
      hint: "enter to toggle · no prompts",
    },
    { id: "workingDir", label: "Working dir", value: settings.workingDir, hint: "enter to edit" },
    { id: "sidebar", label: "Show sidebar", value: settings.showSidebar ? "on" : "off", hint: "enter to toggle" },
    { id: "minimal", label: "Minimal UI", value: settings.minimal ? "on" : "off", hint: "enter to toggle" },
    { id: "compact", label: "Compact transcript", value: settings.compact ? "on" : "off", hint: "enter to toggle" },
    { id: "accent", label: "Accent", value: accentName(settings.accent), hint: "←→" },
  ];

  const clamped = Math.min(index, fields.length - 1);
  const current = fields[clamped];

  // Fixed chrome: paddingY (2) + header (1) + list gap (1) + "more" markers (2)
  // + footer gap and line (2) = 8 rows.
  const windowSize = Math.max(3, height - 8);
  const start = Math.max(
    0,
    Math.min(clamped - Math.floor(windowSize / 2), Math.max(0, fields.length - windowSize)),
  );
  const view = fields.slice(start, start + windowSize);
  const above = start;
  const below = Math.max(0, fields.length - (start + windowSize));

  const adjust = (dir: number) => {
    switch (current?.id) {
      case "temperature":
        onPatch({ temperature: clamp(round(settings.temperature + dir * 0.1), 0, TEMPERATURE_MAX) });
        break;
      case "maxTokens":
        onPatch({ maxTokens: Math.max(0, settings.maxTokens + dir * 256) });
        break;
      case "reasoning": {
        const order: Settings["reasoning"]["effort"][] = ["low", "medium", "high"];
        const i = order.indexOf(settings.reasoning.effort);
        const next = order[clamp(i + dir, 0, order.length - 1)]!;
        onPatch({ reasoning: { ...settings.reasoning, effort: next } });
        break;
      }
      case "accent": {
        const i = ACCENTS.findIndex((a) => a.value === settings.accent);
        const next = ACCENTS[clamp((i < 0 ? 0 : i) + dir, 0, ACCENTS.length - 1)]!;
        onPatch({ accent: next.value });
        break;
      }
    }
  };

  const activate = () => {
    switch (current?.id) {
      case "provider":
        onPickProvider();
        break;
      case "model":
        onPickModel();
        break;
      case "agent":
        onPickAgent();
        break;
      case "apiKey":
      case "baseUrl":
      case "workingDir":
      case "ggufPath":
      case "mmprojPath":
      case "llamaBin":
      case "llamaArgs":
        setEditing(current.id);
        break;
      case "reasoning":
        onPatch({ reasoning: { ...settings.reasoning, enabled: !settings.reasoning.enabled } });
        break;
      case "autoApprove":
        onPatch({ autoApproveSafeTools: !settings.autoApproveSafeTools });
        break;
      case "autoApproveAll":
        onPatch({ autoApproveAll: !settings.autoApproveAll });
        break;
      case "sidebar":
        onPatch({ showSidebar: !settings.showSidebar });
        break;
      case "minimal":
        onPatch({ minimal: !settings.minimal });
        break;
      case "compact":
        onPatch({ compact: !settings.compact });
        break;
    }
  };

  useInput(
    (input, key) => {
      if (key.escape) {
        onClose();
        return;
      }
      if (key.upArrow) {
        setIndex(Math.max(0, clamped - 1));
        return;
      }
      if (key.downArrow) {
        setIndex(Math.min(fields.length - 1, clamped + 1));
        return;
      }
      if (key.pageUp) {
        setIndex(Math.max(0, clamped - windowSize));
        return;
      }
      if (key.pageDown) {
        setIndex(Math.min(fields.length - 1, clamped + windowSize));
        return;
      }
      if (key.leftArrow) {
        adjust(-1);
        return;
      }
      if (key.rightArrow) {
        adjust(1);
        return;
      }
      if (key.return) {
        activate();
        return;
      }
      if (input === "r") {
        onPatch({ reasoning: { ...settings.reasoning, enabled: !settings.reasoning.enabled } });
      }
    },
    { isActive: editing === null },
  );

  if (editing) {
    const editingField = fields.find((f) => f.id === editing);
    return (
      <TextField
        label={editingField?.label ?? editing}
        initial={initialValue(editing, settings)}
        accent={accent}
        theme={t}
        masked={editing === "apiKey"}
        placeholder={placeholderFor(editing)}
        hint={hintFor(editing)}
        onCancel={() => setEditing(null)}
        onSubmit={(value) => {
          applyEdit(editing, value, settings, onPatch);
          setEditing(null);
        }}
      />
    );
  }

  const labelCol = Math.max(16, Math.min(22, Math.floor(width * 0.26)));
  const valueCol = Math.max(14, width - labelCol - 20);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width="100%" height={height} overflow="hidden">
      <Box justifyContent="space-between" width="100%">
        <Text bold color={t.accent}>
          {"✦ "}Settings
        </Text>
        <Text color={t.muted}>↑↓ move · ←→ adjust · enter select · esc back</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} width="100%">
        {above > 0 && (
          <Text color={t.borderFaint} dimColor>
            {`↑ ${above} more`}
          </Text>
        )}
        {view.map((f, i) => {
          const selected = start + i === clamped;
          const label = padEnd(truncate(f.label, labelCol - 1), labelCol);
          return (
            <Text key={f.id} wrap="truncate-end">
              {selected ? (
                <Text backgroundColor={t.accent} color={t.onAccent} bold>
                  {"❯ " + label}
                </Text>
              ) : (
                <Text color={t.text}>
                  {"  " + label}
                </Text>
              )}
              <Text color={selected ? t.accentBright : t.textDim}>
                {truncate(f.value, valueCol)}
              </Text>
              {selected && f.hint ? (
                <Text color={t.muted} dimColor>
                  {"  " + f.hint}
                </Text>
              ) : null}
            </Text>
          );
        })}
        {below > 0 && (
          <Text color={t.borderFaint} dimColor>
            {`↓ ${below} more`}
          </Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={t.muted} dimColor>
          saved automatically to ~/.config/hiraxcode/config.json
        </Text>
      </Box>
    </Box>
  );
}

function accentName(hex: string): string {
  return ACCENTS.find((a) => a.value === hex)?.name ?? hex;
}

/** Human label for a temperature so the number is not a mystery. */
function describeTemperature(t: number): string {
  const tag =
    t < 0.2 ? "precise" : t < 0.5 ? "focused" : t < 0.8 ? "balanced" : "creative";
  return `${t.toFixed(2)} · ${tag}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function initialValue(field: FieldId, s: Settings): string {
  switch (field) {
    case "apiKey":
      return s.apiKeys[s.provider] ?? "";
    case "baseUrl":
      return s.baseUrls[s.provider] ?? "";
    case "workingDir":
      return s.workingDir;
    case "ggufPath":
      return s.ggufPath;
    case "mmprojPath":
      return s.mmprojPath;
    case "llamaBin":
      return s.llamaServerBin;
    case "llamaArgs":
      return s.llamaExtraArgs ?? "";
    default:
      return "";
  }
}

function applyEdit(
  field: FieldId,
  value: string,
  s: Settings,
  onPatch: (p: Partial<Settings>) => void,
): void {
  const v = value.trim();
  switch (field) {
    case "apiKey":
      onPatch({ apiKeys: { ...s.apiKeys, [s.provider]: v } });
      break;
    case "baseUrl": {
      const next = { ...s.baseUrls };
      if (v) next[s.provider] = v;
      else delete next[s.provider];
      onPatch({ baseUrls: next });
      break;
    }
    case "workingDir":
      if (v) onPatch({ workingDir: v });
      break;
    case "ggufPath":
      onPatch({ ggufPath: v });
      break;
    case "mmprojPath":
      onPatch({ mmprojPath: v });
      break;
    case "llamaBin":
      onPatch({ llamaServerBin: v || "llama-server" });
      break;
    case "llamaArgs":
      onPatch({ llamaExtraArgs: v });
      break;
  }
}

function placeholderFor(field: FieldId): string {
  switch (field) {
    case "apiKey":
      return "sk-… (comma-separate keys to rotate)";
    case "baseUrl":
      return "leave empty to use the provider default";
    case "workingDir":
      return "/path/to/project";
    case "ggufPath":
      return "/path/to/model.gguf";
    case "mmprojPath":
      return "/path/to/mmproj-model-f16.gguf";
    case "llamaBin":
      return "llama-server (or full path)";
    case "llamaArgs":
      return "--threads 8 --temp 0.7";
    default:
      return "";
  }
}

function hintFor(field: FieldId): string | undefined {
  if (field === "ggufPath") return "Path to a .gguf model. HiraxCode will auto-start llama-server.";
  if (field === "mmprojPath")
    return "Optional multimodal projector (.mmproj). Enables image input for local GGUF models.";
  if (field === "llamaBin") return "Binary name or full path to llama-server.";
  if (field === "llamaArgs") return "Optional extra flags passed to llama-server.";
  return undefined;
}
