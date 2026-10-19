import { Box, Text, useInput } from "ink";
import { packageVersion } from "@/core/version";
import { makeTheme, type Theme } from "../theme";
import { padEnd } from "../lib/text";
import { COMMANDS } from "./CommandMenu";
import { Banner } from "./Banner";

interface HelpScreenProps {
  accent: string;
  configPath: string;
  sessionsPath: string;
  theme?: Theme;
  width?: number;
  /** Available inner height (inside the overlay border/footer). */
  height?: number;
  version?: string;
  onClose?: () => void;
}

const KEYS: [string, string][] = [
  ["enter", "send message"],
  ["/", "command palette"],
  ["tab", "sessions sidebar"],
  ["ctrl+v / alt+v", "attach clipboard image / file"],
  ["ctrl+shift+v", "same, when ctrl+v is captured"],
  ["/paste <path>", "attach image file, folder or *.png"],
  ["/watch", "auto-attach copied screenshots"],
  ["ctrl+b", "toggle sidebar"],
  ["↑ ↓", "scroll lines"],
  ["mouse wheel", "scroll transcript"],
  ["esc", "close / clear"],
  ["y / n", "approve / deny"],
  ["ctrl+c", "quit"],
];

export function HelpScreen({
  accent,
  configPath,
  sessionsPath,
  theme,
  width = 80,
  height = 24,
  version = packageVersion(),
  onClose,
}: HelpScreenProps) {
  const t = theme ?? makeTheme(accent);
  const avail = Math.max(40, width - 8);
  const gap = 2;
  const keyCol = Math.max(22, Math.min(34, Math.floor(avail * 0.42)));
  const cmdCol = Math.max(22, avail - keyCol - gap);

  useInput((input, key) => {
    if (key.escape || input === "q") onClose?.();
  });

  const showBanner = height >= 12;
  const showFiles = height >= 17;

  // Rows that are always present: padding top/bottom, the footer (+ its gap),
  // and optionally the banner (+ gap) and the files block.
  const overhead = 2 + 2 + (showBanner ? 2 : 0) + (showFiles ? 4 : 0);
  const maxColRows = Math.max(4, height - overhead);

  const layout = (rows: [string, string][]): [string, string][] => {
    const w = Math.max(12, ...rows.map(([left]) => left.length + 1));
    return rows.map(([left, right]) => [padEnd(left, w), right]);
  };

  const keyRows = layout(KEYS);
  const cmdRows = layout(
    COMMANDS.map<[string, string]>((c) => [c.name + (c.args ? " " + c.args : ""), c.description]),
  );

  const renderColumn = (title: string, rows: [string, string][], col: number, key: string) => {
    const bodyMax = Math.max(1, maxColRows - 1);
    const truncated = rows.length > bodyMax;
    const shown = truncated ? rows.slice(0, Math.max(0, bodyMax - 1)) : rows;
    const more = rows.length - shown.length;
    return (
      <Box flexDirection="column" width={col} flexShrink={0} key={key}>
        <Text bold color={t.accent}>
          {title}
        </Text>
        {shown.map(([left, right]) => (
          <Text key={left.trim()} wrap="truncate-end">
            <Text color={t.accentBright}>{left}</Text>
            <Text color={t.textDim}>{right}</Text>
          </Text>
        ))}
        {truncated && (
          <Text color={t.muted} dimColor>
            {`… +${more} more`}
          </Text>
        )}
      </Box>
    );
  };

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      width="100%"
      height="100%"
      overflow="hidden"
    >
      {showBanner && (
        <Box marginBottom={1} flexShrink={0}>
          <Banner theme={t} minimal />
          <Text color={t.muted}> v{version}</Text>
        </Box>
      )}

      <Box flexDirection="row" width="100%" flexShrink={0}>
        {renderColumn("Keyboard", keyRows, keyCol, "keys")}
        <Box width={gap} flexShrink={0} />
        {renderColumn("Commands", cmdRows, cmdCol, "cmds")}
      </Box>

      {showFiles && (
        <Box marginTop={1} flexDirection="column" flexShrink={0}>
          <Text bold color={t.accent}>
            Files
          </Text>
          <Text wrap="truncate-end">
            <Text color={t.textDim}>{"config    "}</Text>
            <Text color={t.muted}>{configPath}</Text>
          </Text>
          <Text wrap="truncate-end">
            <Text color={t.textDim}>{"sessions  "}</Text>
            <Text color={t.muted}>{sessionsPath}</Text>
          </Text>
        </Box>
      )}

      <Box marginTop={1} flexShrink={0}>
        <Text color={t.muted} dimColor>
          esc to go back
        </Text>
      </Box>
    </Box>
  );
}
