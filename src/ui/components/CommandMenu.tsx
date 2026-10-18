import { Box, Text } from "ink";
import { makeTheme, type Theme } from "../theme";
import { padEnd, truncate } from "../lib/text";

export interface Command {
  name: string;
  args?: string;
  description: string;
}

export const COMMANDS: Command[] = [
  { name: "/model", description: "Pick a model" },
  { name: "/provider", description: "Switch provider (models.dev)" },
  { name: "/agent", args: "[id]", description: "Switch agent" },
  { name: "/pentest", description: "Switch to the Pentest agent" },
  { name: "/paste", args: "[path]", description: "Attach clipboard image or a file" },
  { name: "/file", args: "<path>", description: "Attach an image file" },
  { name: "/drop", description: "Remove attached images" },
  { name: "/settings", description: "Open settings" },
  { name: "/sessions", description: "Toggle sessions sidebar" },
  { name: "/new", description: "Start a new session" },
  { name: "/clear", description: "Clear the conversation" },
  { name: "/cd", args: "<path>", description: "Change working directory" },
  { name: "/reasoning", description: "Toggle model thinking" },
  { name: "/temp", args: "<0-1>", description: "Set temperature (creativity)" },
  { name: "/compact", description: "Toggle compact density" },
  { name: "/yolo", description: "Auto-approve all tools (no prompts)" },
  { name: "/theme", description: "Cycle the accent colour" },
  { name: "/help", description: "Show help" },
  { name: "/exit", description: "Quit HiraxCode" },
];

export const MAX_COMMAND_ROWS = 8;

/** Commands matching a partial query (must start with `/`). */
export function matchCommands(query: string): Command[] {
  const q = query.toLowerCase();
  const needle = q.replace(/^\//, "");
  const exact = COMMANDS.filter((c) => c.name === q);
  if (exact.length === 1) return exact;
  // Return *all* matches — the menu scrolls through them, so nothing is ever
  // unreachable just because the list is longer than the visible window.
  return COMMANDS.filter((c) => c.name.startsWith(q) || c.name.slice(1).startsWith(needle));
}

/** The slice of `total` items to show so `selected` stays visible. */
export function windowCommands(total: number, selected: number, cap = MAX_COMMAND_ROWS) {
  if (total <= cap) return { start: 0, end: total };
  const start = Math.max(0, Math.min(selected - Math.floor(cap / 2), total - cap));
  return { start, end: start + cap };
}

interface CommandMenuProps {
  query: string;
  accent: string;
  theme?: Theme;
  selected?: number;
  width?: number;
}

export function CommandMenu({ query, accent, theme, selected = 0, width = 80 }: CommandMenuProps) {
  const t = theme ?? makeTheme(accent);
  const matches = matchCommands(query);
  if (matches.length === 0) return null;

  const { start, end } = windowCommands(matches.length, selected);
  const visible = matches.slice(start, end);
  const moreAbove = start > 0;
  const moreBelow = end < matches.length;

  return (
    <Box flexDirection="column" width="100%" paddingX={1} flexShrink={0}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={t.border}
        paddingX={1}
        width="100%"
      >
        {visible.map((c, i) => {
          const active = start + i === selected;
          const nameCol = Math.max(10, Math.min(18, Math.floor(width * 0.22)));
          const name = padEnd(c.name + (c.args ? " " + c.args : ""), nameCol);
          return (
            <Text key={c.name} wrap="truncate-end">
              {active ? (
                <Text backgroundColor={t.accent} color={t.onAccent} bold>
                  {"❯ " + name}
                </Text>
              ) : (
                <Text>
                  <Text color={t.borderFaint}>{"  "}</Text>
                  <Text color={t.label} bold>
                    {name}
                  </Text>
                </Text>
              )}
              <Text color={active ? t.textDim : t.muted} dimColor={!active}>
                {truncate(c.description, Math.max(10, width - nameCol - 8))}
              </Text>
            </Text>
          );
        })}
        {(moreAbove || moreBelow) && (
          <Text wrap="truncate-end" color={t.muted} dimColor>
            {"  "}
            {moreAbove ? "↑" : " "}
            {` ${start + 1}–${end} of ${matches.length} `}
            {moreBelow ? "↓ more" : ""}
          </Text>
        )}
      </Box>
    </Box>
  );
}
