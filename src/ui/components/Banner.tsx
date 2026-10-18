import { Box, Text } from "ink";
import { makeTheme, type Theme } from "../theme";
import { mix } from "@/utils/color";

/**
 * The `HIRAXCODE` wordmark in a block/box-drawing face. Each line is fixed
 * width (68 columns); the first 35 columns spell `HIRAX`, the rest `CODE`.
 */
const WORDMARK = [
  "██╗  ██╗██╗██████╗  █████╗ ██╗  ██╗ ██████╗ ██████╗ ██████╗ ███████╗",
  "██║  ██║██║██╔══██╗██╔══██╗╚██╗██╔╝██╔════╝██╔═══██╗██╔══██╗██╔════╝",
  "███████║██║██████╔╝███████║ ╚███╔╝ ██║     ██║   ██║██║  ██║█████╗  ",
  "██╔══██║██║██╔══██╗██╔══██║ ██╔██╗ ██║     ██║   ██║██║  ██║██╔══╝  ",
  "██║  ██║██║██║  ██║██║  ██║██╔╝ ██╗╚██████╗╚██████╔╝██████╔╝███████╗",
  "╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝",
];

/** Column where `HIRAX` ends and `CODE` begins. */
const SPLIT = 35;

const ROWS = WORDMARK.length;

interface BannerProps {
  accent?: string;
  theme?: Theme;
  subtitle?: string;
  /** Compact form: just the `HiraxCode` lockup, no block logo. */
  minimal?: boolean;
}

/**
 * The HiraxCode wordmark: a two-tone block logo (neutral `HIRAX`, accent
 * `CODE`) lit by a top-to-bottom gradient.
 */
export function Banner({ accent, theme, subtitle, minimal }: BannerProps) {
  const t = theme ?? makeTheme(accent ?? "#fab283");

  if (minimal) {
    return (
      <Box flexDirection="column">
        <BrandLine t={t} />
        {subtitle && <Text color={t.muted}>{subtitle}</Text>}
      </Box>
    );
  }

  // Rows warm up toward the baseline: a quiet sheen rather than one flat fill.
  const mixAt = (from: string, to: string, i: number) => mix(from, to, i / (ROWS - 1));
  const leftColor = (i: number) => mixAt(mix(t.bg, t.textDim, 0.75), t.text, i);
  const rightColor = (i: number) => mixAt(mix(t.bg, t.accent, 0.75), mix(t.accent, "#ffffff", 0.2), i);

  return (
    <Box flexDirection="column">
      {WORDMARK.map((line, i) => (
        <Text key={i}>
          <Text color={leftColor(i)}>{line.slice(0, SPLIT)}</Text>
          <Text bold color={rightColor(i)}>
            {line.slice(SPLIT).replace(/\s+$/, "")}
          </Text>
        </Text>
      ))}
      {subtitle && (
        <Box marginTop={1}>
          <Text color={t.muted}>{subtitle}</Text>
        </Box>
      )}
    </Box>
  );
}

/** The literal `HiraxCode` lockup, used on the welcome screen and overlays. */
export function BrandLine({ t }: { t: Theme }) {
  return (
    <Text bold>
      <Text color={t.text}>Hirax</Text>
      <Text color={t.accent}>Code</Text>
    </Text>
  );
}
