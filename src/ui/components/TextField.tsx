import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { makeTheme, type Theme } from "../theme";
import { sanitizeInput } from "../lib/input";
import { truncate } from "../lib/text";

interface TextFieldProps {
  label: string;
  initial?: string;
  accent: string;
  masked?: boolean;
  placeholder?: string;
  hint?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  theme?: Theme;
  width?: number;
}

export function TextField({
  label,
  initial = "",
  accent,
  masked,
  placeholder = "",
  hint,
  onSubmit,
  onCancel,
  theme,
  width = 80,
}: TextFieldProps) {
  const t = theme ?? makeTheme(accent);
  const [value, setValue] = useState(initial);
  const [show, setShow] = useState(!masked);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key.tab) {
      setShow((s) => !s);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      const clean = sanitizeInput(input);
      if (clean) setValue((v) => v + clean);
    }
  });

  const display = value ? (show ? value : "•".repeat(Math.min(value.length, 60))) : "";
  const inner = Math.max(20, width - 8);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width="100%">
      <Text bold color={t.accent}>
        {"✦ "}
        {label}
      </Text>
      <Box marginTop={1} borderStyle="round" borderColor={t.borderActive} paddingX={1} width={inner}>
        <Text color={display ? t.text : t.muted}>{truncate(display || placeholder, inner - 4)}</Text>
        <Text color={t.accent} bold>
          ▌
        </Text>
      </Box>
      {masked && (
        <Box marginTop={1}>
          <Text color={t.muted} dimColor>
            tab: show / hide
          </Text>
        </Box>
      )}
      {hint && (
        <Box marginTop={1}>
          <Text color={t.muted} dimColor>
            {hint}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={t.muted}>
          <Text color={t.textDim}>enter</Text> save · <Text color={t.textDim}>esc</Text> cancel
        </Text>
      </Box>
    </Box>
  );
}
