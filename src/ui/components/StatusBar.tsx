import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Usage } from "@/core/types";
import { makeTheme, type Theme } from "../theme";
import { truncate, width } from "../lib/text";

interface StatusBarProps {
  messageCount: number;
  usage: Usage | null;
  running: boolean;
  accent: string;
  notice: string | null;
  hint: string;
  theme?: Theme;
  width?: number;
  scrollHint?: string | null;
  model?: string;
  queued?: number;
}

/** The footer rule: `● status │ tokens` … right-aligned hints. */
export function StatusBar(props: StatusBarProps) {
  const t = props.theme ?? makeTheme(props.accent);
  const cols = props.width ?? 80;
  // Give the right-hand hint its natural width where it fits, otherwise half the
  // row; keep a gap so the left status never collides with it.
  const hintW = Math.min(width(props.hint), Math.max(16, Math.floor(cols * 0.5)));
  const noticeW = Math.max(10, cols - hintW - 24);

  return (
    <Box paddingX={1} width="100%" justifyContent="space-between" flexShrink={0}>
      <Box flexGrow={1} flexShrink={1} overflow="hidden" marginRight={2}>
        <Text wrap="truncate-end">
          {props.running ? (
            <Text color={t.warning}>
              <Spinner type="dots" />
              {" working"}
            </Text>
          ) : (
            <Text color={t.textDim}>{"● idle"}</Text>
          )}
          {props.usage ? (
            <>
              <Sep t={t} />
              <Text color={t.muted}>
                {props.usage.total} tok
                <Text color={t.borderFaint}>
                  {" ↑" + props.usage.prompt + " ↓" + props.usage.completion}
                </Text>
              </Text>
            </>
          ) : (
            <>
              <Sep t={t} />
              <Text color={t.muted}>{props.messageCount} msg</Text>
            </>
          )}
          {props.scrollHint ? (
            <>
              <Sep t={t} />
              <Text color={t.warning}>{props.scrollHint}</Text>
            </>
          ) : null}
          {props.queued && props.queued > 0 ? (
            <>
              <Sep t={t} />
              <Text color={t.info}>{props.queued} queued</Text>
            </>
          ) : null}
          {props.notice ? (
            <>
              <Sep t={t} />
              <Text color={t.warning}>{truncate(props.notice, noticeW)}</Text>
            </>
          ) : null}
        </Text>
      </Box>
      <Box width={hintW} flexShrink={0} justifyContent="flex-end">
        <Text wrap="truncate-end" color={t.muted}>
          {props.hint}
        </Text>
      </Box>
    </Box>
  );
}

function Sep({ t }: { t: Theme }) {
  return <Text color={t.borderFaint}>{" │ "}</Text>;
}
