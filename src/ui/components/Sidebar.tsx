import { Box, Text } from "ink";
import type { Session } from "@/core/types";
import { makeTheme, type Theme } from "../theme";
import { padEnd, truncate } from "../lib/text";

interface SidebarProps {
  sessions: Session[];
  activeId: string | null;
  focused: boolean;
  index: number;
  accent: string;
  theme?: Theme;
  height?: number;
  width?: number;
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d` : `${Math.floor(d / 7)}w`;
}

export function Sidebar({
  sessions,
  activeId,
  focused,
  index,
  accent,
  theme,
  height = 24,
  width = 30,
}: SidebarProps) {
  const t = theme ?? makeTheme(accent);
  const inner = width - 2; // borders
  const windowSize = Math.max(3, height - 6);
  const clamped = Math.min(index, Math.max(0, sessions.length - 1));
  const start = Math.max(
    0,
    Math.min(clamped - Math.floor(windowSize / 2), Math.max(0, sessions.length - windowSize)),
  );
  const view = sessions.slice(start, start + windowSize);
  const above = start;
  const below = Math.max(0, sessions.length - (start + windowSize));

  return (
    <Box
      flexDirection="column"
      width={width}
      height="100%"
      borderStyle="round"
      borderColor={focused ? t.borderActive : t.border}
      flexShrink={0}
    >
      <Box paddingX={1}>
        <Text bold color={t.accent}>
          {"✦ "}
          sessions
        </Text>
        <Text color={t.muted}> {sessions.length}</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} marginTop={1} flexGrow={1}>
        {sessions.length === 0 ? (
          <Text color={t.muted} dimColor>
            no sessions yet
          </Text>
        ) : (
          <>
            {above > 0 && (
              <Text color={t.borderFaint} dimColor>
                {`↑ ${above}`}
              </Text>
            )}
            {view.map((s, i) => {
              const realIndex = start + i;
              const active = s.id === activeId;
              const selected = focused && realIndex === clamped;
              const titleW = inner - 8;
              const title = padEnd(truncate(s.title || "New Chat", titleW), titleW);
              const time = relTime(s.updatedAt);
              return (
                <Text key={s.id} wrap="truncate-end">
                  {selected ? (
                    <Text backgroundColor={t.accent} color={t.onAccent} bold>
                      {"▸ " + title + " " + time}
                    </Text>
                  ) : (
                    <Text>
                      <Text color={active ? t.accent : t.muted}>{active ? "▸ " : "  "}</Text>
                      <Text color={active ? t.text : t.textDim} bold={active}>
                        {title}
                      </Text>
                      <Text color={t.muted}> {time}</Text>
                    </Text>
                  )}
                </Text>
              );
            })}
            {below > 0 && (
              <Text color={t.borderFaint} dimColor>
                {`↓ ${below}`}
              </Text>
            )}
          </>
        )}
      </Box>

      <Box paddingX={1}>
        <Text color={t.muted} dimColor wrap="truncate-end">
          {focused ? "↵ open · n new · q close" : "tab to focus"}
        </Text>
      </Box>
    </Box>
  );
}
