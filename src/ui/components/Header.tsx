import { Box, Text } from "ink";
import type { Usage } from "@/core/types";
import { makeTheme, type Theme } from "../theme";
import { truncate } from "../lib/text";

interface HeaderProps {
  title: string;
  usage: Usage | null;
  theme?: Theme;
  accent?: string;
  width?: number;
}

/**
 * The session header: a framed title on the left with the token
 * counters on the right — `# Session title            39,413  20% ($0.29)`.
 */
export function Header({ title, usage, theme, accent, width = 80 }: HeaderProps) {
  const t = theme ?? makeTheme(accent ?? "#fab283");
  const usageText = usage
    ? `${fmt(usage.total)} tok  ↑${fmt(usage.prompt)} ↓${fmt(usage.completion)}`
    : "";

  return (
    <Box width="100%" paddingX={1} flexShrink={0}>
      <Box
        width="100%"
        borderStyle="round"
        borderColor={t.border}
        paddingX={1}
        justifyContent="space-between"
      >
        <Text wrap="truncate-end">
          <Text color={t.muted}>{"# "}</Text>
          <Text bold color={t.text}>
            {truncate(title || "New session", Math.max(12, width - usageText.length - 12))}
          </Text>
        </Text>
        {usageText ? (
          <Text wrap="truncate-end" color={t.muted}>
            {usageText}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
