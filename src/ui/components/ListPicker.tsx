import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useMemo, useState } from "react";
import { makeTheme, type Theme } from "../theme";
import { sanitizeInput } from "../lib/input";
import { padEnd, truncate } from "../lib/text";

export interface ListItem {
  label: string;
  value: string;
  hint?: string;
}

interface ListPickerProps {
  title: string;
  items: ListItem[];
  accent: string;
  loading?: boolean;
  emptyText?: string;
  footer?: string;
  height?: number;
  allowCustom?: boolean;
  customPrefix?: string;
  onSelect: (value: string) => void;
  onCancel: () => void;
  theme?: Theme;
  width?: number;
}

export function ListPicker({
  title,
  items,
  accent,
  loading,
  emptyText = "Nothing here",
  footer,
  height = 16,
  allowCustom,
  customPrefix = "Use",
  onSelect,
  onCancel,
  theme,
  width = 80,
}: ListPickerProps) {
  const t = theme ?? makeTheme(accent);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const pageSize = Math.max(3, height);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.value.toLowerCase().includes(q) ||
        (i.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query]);

  const display = useMemo(() => {
    const q = query.trim();
    if (allowCustom && q && !filtered.some((i) => i.value === q)) {
      return [...filtered, { label: `${customPrefix} "${q}"`, value: q, hint: "custom" }];
    }
    return filtered;
  }, [filtered, allowCustom, query, customPrefix]);

  const clamped = Math.min(index, Math.max(0, display.length - 1));

  const start = Math.max(
    0,
    Math.min(clamped - Math.floor(pageSize / 2), Math.max(0, display.length - pageSize)),
  );
  const view = display.slice(start, start + pageSize);
  const moreAbove = start;
  const moreBelow = Math.max(0, display.length - (start + pageSize));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setIndex(Math.max(0, clamped - 1));
      return;
    }
    if (key.downArrow) {
      setIndex(Math.min(display.length - 1, clamped + 1));
      return;
    }
    if (key.pageUp) {
      setIndex(Math.max(0, clamped - pageSize));
      return;
    }
    if (key.pageDown) {
      setIndex(Math.min(display.length - 1, clamped + pageSize));
      return;
    }
    if (key.return) {
      const item = display[clamped];
      if (item) onSelect(item.value);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setIndex(0);
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.tab && input !== "escape") {
      const clean = sanitizeInput(input);
      if (clean) {
        setQuery((q) => q + clean);
        setIndex(0);
      }
    }
  });

  const countLabel = display.length > 0 ? `${clamped + 1}/${display.length}` : "0/0";

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width="100%">
      <Box justifyContent="space-between" width="100%">
        <Text bold color={t.accent}>
          {"✦ "}
          {title}
        </Text>
        <Text color={t.muted}>{countLabel}</Text>
      </Box>

      <Box marginTop={1} width="100%" paddingX={1}>
        <Text color={t.accent}>{"❯ "}</Text>
        {query ? (
          <Text color={t.text}>{query}</Text>
        ) : (
          <Text color={t.muted}>type to filter…</Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1} width="100%">
        {loading ? (
          <Text color={t.textDim}>
            <Spinner type="dots" /> loading models…
          </Text>
        ) : display.length === 0 ? (
          <Text color={t.muted}>{emptyText}</Text>
        ) : (
          <>
            {moreAbove > 0 && (
              <Text color={t.borderFaint} dimColor>
                {`  ↑ ${moreAbove} more`}
              </Text>
            )}
            {view.map((item, i) => {
              const realIndex = start + i;
              const selected = realIndex === clamped;
              const nameCol = Math.max(12, Math.min(30, Math.floor(width * 0.3)));
              const label = padEnd(truncate(item.label, nameCol), nameCol);
              const hintW = Math.max(10, width - nameCol - 10);
              return (
                <Text key={`${item.value}:${realIndex}`} wrap="truncate-end">
                  {selected ? (
                    <Text backgroundColor={t.accent} color={t.onAccent} bold>
                      {"❯ " + label}
                    </Text>
                  ) : (
                    <Text>
                      <Text color={t.muted}>{"  "}</Text>
                      <Text color={t.text}>{label}</Text>
                    </Text>
                  )}
                  {item.hint ? (
                    <Text color={selected ? t.textDim : t.muted} dimColor={!selected}>
                      {truncate(item.hint, hintW)}
                    </Text>
                  ) : null}
                </Text>
              );
            })}
            {moreBelow > 0 && (
              <Text color={t.borderFaint} dimColor>
                {`  ↓ ${moreBelow} more`}
              </Text>
            )}
          </>
        )}
      </Box>

      <Box marginTop={1} width="100%">
        <Text color={t.muted} dimColor>
          {footer ?? "↑↓ move · enter select · type to filter · esc back"}
        </Text>
      </Box>
    </Box>
  );
}
