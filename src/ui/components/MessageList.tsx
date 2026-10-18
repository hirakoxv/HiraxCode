import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React, { useEffect, useMemo } from "react";
import type { Message, ToolCall } from "@/core/types";
import { makeTheme, type Theme } from "../theme";
import { parseInline, renderSpans, wrapSpans, span, type Span } from "../lib/markdown";
import { padEnd, truncate, width, wrap, wrapCode } from "../lib/text";

interface TranscriptMetrics {
  total: number;
  visible: number;
  start: number;
  atBottom: boolean;
}

interface MessageListProps {
  messages: Message[];
  running: boolean;
  streamingThought: string;
  streamingContent: string;
  activeTool: ToolCall | null;
  compact: boolean;
  accent: string;
  providerName: string;
  model: string;
  hasKey: boolean;
  theme?: Theme;
  width?: number;
  height?: number;
  scroll?: number;
  minimal?: boolean;
  agentName?: string;
  onMetrics?: (metrics: TranscriptMetrics) => void;
}

/** How far the message body is inset from the left gutter. */
const GUTTER = 2;
const PAD = " ".repeat(GUTTER);

/** The leading glyph for each inline tool row (2 columns wide). */
function toolIcon(name: string | undefined): string {
  const n = (name ?? "").toLowerCase();
  if (/(write|edit|patch|multiedit|create|apply)/.test(n)) return "←";
  if (/(read|view|cat|open|fetch|http|web)/.test(n)) return "→";
  if (/(grep|glob|search|find|list|ls|scan)/.test(n)) return "∗";
  if (/(bash|shell|run|exec|terminal|command)/.test(n)) return "$";
  if (/(todo|task|plan)/.test(n)) return "☰";
  return "•";
}

export function MessageList(props: MessageListProps) {
  const theme = props.theme ?? makeTheme(props.accent);
  const widthAvail = Math.max(24, props.width ?? 80);
  const height = Math.max(3, props.height ?? 20);
  const scroll = Math.max(0, props.scroll ?? 0);
  const inner = widthAvail - 2; // the viewport adds 1 column of padding each side

  const rows = useMemo(() => {
    if (props.messages.length === 0 && !props.running) return [];
    return buildRows({
      messages: props.messages,
      running: props.running,
      streamingThought: props.streamingThought,
      streamingContent: props.streamingContent,
      activeTool: props.activeTool,
      compact: props.compact,
      minimal: props.minimal,
      agentName: props.agentName,
      theme,
      inner,
    });
  }, [
    props.messages,
    props.running,
    props.streamingThought,
    props.streamingContent,
    props.activeTool,
    props.compact,
    props.minimal,
    props.agentName,
    theme,
    inner,
  ]);

  const total = rows.length;
  const end = Math.max(0, total - scroll);
  const start = Math.max(0, end - height);
  const visibleRows = rows.slice(start, end).map((node, i) => (
    <Box key={start + i} flexShrink={0}>
      {node}
    </Box>
  ));

  useEffect(() => {
    props.onMetrics?.({
      total,
      visible: height,
      start,
      atBottom: end >= total,
    });
  }, [total, height, start, end, props.onMetrics]);

  return (
    <Box
      flexDirection="column"
      height={height}
      flexShrink={0}
      paddingX={1}
      overflow="hidden"
      justifyContent="flex-start"
    >
      {visibleRows}
    </Box>
  );
}

// ── row builders ────────────────────────────────────────────────────────────

interface BuildOpts {
  messages: Message[];
  running: boolean;
  streamingThought: string;
  streamingContent: string;
  activeTool: ToolCall | null;
  compact: boolean;
  minimal?: boolean;
  agentName?: string;
  theme: Theme;
  inner: number;
}

function buildRows(o: BuildOpts): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  const push = (node: React.ReactNode) => rows.push(node);

  o.messages.forEach((m, i) => {
    const prev = o.messages[i - 1];
    if (prev && !o.minimal) {
      // A fresh user turn opens a block; tool results stay glued to their call.
      const callAndResult =
        m.role === "tool" &&
        prev.role === "assistant" &&
        !!prev.toolName &&
        prev.toolCallId === m.toolCallId;
      if (m.role === "user") {
        push(blank(`gap:${m.id}`));
      } else if (!callAndResult) {
        push(blank(`gap:${m.id}`));
      }
    }
    buildMessage(m, o, push);
  });

  if (o.running) {
    if (o.messages.length > 0 && !o.minimal) push(blank("gap:live"));
    buildLiveStream(o, push);
  } else if (o.messages.length > 0) {
    if (!o.minimal) push(blank("tail"));
  }

  return rows;
}

type Push = (node: React.ReactNode) => void;

function buildMessage(message: Message, o: BuildOpts, push: Push) {
  if (message.role === "user") return buildUser(message, o, push);
  if (message.role === "tool") return buildToolResult(message, o, push);
  if (message.role === "assistant" && message.toolName && !message.content) {
    return buildToolCall(message, o, push);
  }
  return buildAssistant(message, o, push);
}

function buildUser(message: Message, o: BuildOpts, push: Push) {
  const t = o.theme;
  const content = message.content.trim() || "(empty message)";
  const avail = Math.max(8, o.inner - GUTTER);
  const lines = wrap(content, avail);
  const keys = message.id;

  lines.forEach((line, i) => {
    push(
      row(
        `${keys}:u${i}`,
        <Text wrap="truncate-end" backgroundColor={t.bgRaised}>
          <Text color={t.borderActive}>{"┃ "}</Text>
          <Text color={t.text}>{line}</Text>
        </Text>,
      ),
    );
  });

  if (message.images && message.images.length > 0) {
    const names = message.images.map((im) => im.name ?? "image").join(", ");
    const label = `${message.images.length} image${message.images.length === 1 ? "" : "s"}`;
    push(
      row(
        keys + ":imgs",
        <Text wrap="truncate-end">
          <Text color={t.borderActive}>{"┃ "}</Text>
          <Text color={t.accent}>{"▣ "}</Text>
          <Text color={t.textDim}>{label}</Text>
          <Text color={t.muted}>{" · " + names}</Text>
        </Text>,
      ),
    );
  }
}

function buildAssistant(message: Message, o: BuildOpts, push: Push) {
  const keys = message.id;
  if (message.thinking && !o.minimal) {
    pushThinking(message.thinking, o, push, keys + ":think");
  }
  pushMarkdown(message.content ?? "", o, push, keys + ":c");
}

function buildToolCall(message: Message, o: BuildOpts, push: Push) {
  const t = o.theme;
  const args = previewArgs(message.toolArgs);
  push(
    row(
      message.id,
      <Text wrap="truncate-end">
        <Text>{PAD}</Text>
        <Text color={t.muted}>{toolIcon(message.toolName) + " "}</Text>
        <Text color={t.textDim}>{message.toolName}</Text>
        {args && <Text color={t.muted}>{"  " + args}</Text>}
      </Text>,
    ),
  );
}

function buildToolResult(message: Message, o: BuildOpts, push: Push) {
  const t = o.theme;
  const keys = message.id;
  const result = message.toolResult;
  const ok = result?.success ?? false;
  const body = (ok ? result?.output || "(no output)" : result?.error || "failed").trimEnd();
  const limit = o.compact ? 6 : 14;
  const indent = PAD + "  ";

  const bodyLines = wrap(body, Math.max(8, o.inner - indent.length));
  const shown = bodyLines.slice(0, limit);
  const hidden = bodyLines.length - shown.length;

  shown.forEach((line, i) => {
    push(
      row(
        `${keys}:b${i}`,
        <Text wrap="truncate-end">
          <Text color={t.borderFaint}>{indent}</Text>
          <Text color={ok ? t.muted : t.danger} dimColor={ok}>
            {(i === 0 ? (ok ? "" : "✗ ") : "") + line}
          </Text>
        </Text>,
      ),
    );
  });
  if (hidden > 0) {
    push(
      row(
        keys + ":more",
        <Text wrap="truncate-end">
          <Text color={t.borderFaint}>{indent}</Text>
          <Text color={t.muted} dimColor>
            {`… ${hidden} more line${hidden === 1 ? "" : "s"}`}
          </Text>
        </Text>,
      ),
    );
  }
}

function buildLiveStream(o: BuildOpts, push: Push) {
  const t = o.theme;

  if (o.streamingThought) pushThinking(o.streamingThought, o, push, "live:think", true);
  if (o.streamingContent) pushMarkdown(o.streamingContent, o, push, "live:c");

  if (o.activeTool) {
    const args = previewArgs(o.activeTool.args);
    push(
      row(
        "live:tool",
        <Text wrap="truncate-end">
          <Text>{PAD}</Text>
          <Text color={t.accent}>
            <Spinner type="dots" />
          </Text>
          <Text color={t.textDim}>{" " + o.activeTool.name}</Text>
          {args && <Text color={t.muted}>{"  " + args}</Text>}
        </Text>,
      ),
    );
  } else if (!o.streamingContent && !o.streamingThought) {
    push(
      row(
        "live:caret",
        <Text>
          <Text>{PAD}</Text>
          <Text color={t.accent}>
            <Spinner type="dots" />
          </Text>
          <Text color={t.muted}> Thinking…</Text>
        </Text>,
      ),
    );
  }
}

function pushThinking(text: string, o: BuildOpts, push: Push, key: string, live = false) {
  const t = o.theme;
  const lines = wrap(text.trim(), o.inner - GUTTER);
  const limit = o.compact ? 6 : 18;
  const shown = lines.slice(0, limit);
  const hidden = lines.length - shown.length;
  push(
    row(
      key + ":head",
      <Text>
        <Text>{PAD}</Text>
        <Text color={t.warning}>{"✻ "}</Text>
        <Text color={t.warning} italic>
          {live ? "Thinking…" : "Thought"}
        </Text>
      </Text>,
    ),
  );
  shown.forEach((line, i) => {
    push(
      row(
        `${key}:${i}`,
        <Text wrap="truncate-end">
          <Text color={t.borderFaint}>{PAD + "▏ "}</Text>
          <Text color={t.thinking} dimColor>
            {line}
          </Text>
        </Text>,
      ),
    );
  });
  if (hidden > 0) {
    push(
      row(
        key + ":more",
        <Text color={t.muted} dimColor>
          <Text color={t.borderFaint}>{PAD + "▏ "}</Text>
          {`… ${hidden} more line${hidden === 1 ? "" : "s"}`}
        </Text>,
      ),
    );
  }
}

function pushMarkdown(text: string, o: BuildOpts, push: Push, key: string) {
  const t = o.theme;
  const avail = o.inner - GUTTER;
  const lines = text.split("\n");
  const maxBody = o.compact ? 24 : 200;
  let produced = 0;
  let codeLang: string | null = null;
  let codeBuf: string[] = [] as string[];
  let codeIndex = 0;
  let i = 0;
  let truncated = false;

  const flushCode = () => {
    if (codeLang === null) return;
    const label = (codeLang || "code").trim();
    const maxContent = Math.max(8, o.inner - GUTTER - 3);

    const pieces: string[] = [];
    for (const raw of codeBuf) {
      for (const piece of wrapCode(raw, maxContent)) pieces.push(piece);
    }

    let contentW = Math.min(maxContent, width(label) + 2);
    for (const p of pieces) contentW = Math.max(contentW, width(p));
    contentW = Math.min(contentW, maxContent);

    push(
      row(
        `${key}:code:${codeIndex}:t`,
        <Text wrap="truncate-end">
          <Text color={t.borderFaint}>{PAD + "▏ "}</Text>
          <Text color={t.muted}>{label}</Text>
        </Text>,
      ),
    );
    pieces.forEach((piece) => {
      push(
        row(
          `${key}:code:${codeIndex}:${produced++}`,
          <Text wrap="truncate-end" backgroundColor={t.bgElement}>
            <Text color={t.borderFaint}>{PAD + "▏ "} </Text>
            <Text color={t.code}>{padEnd(piece, contentW)}</Text>
            <Text> </Text>
          </Text>,
        ),
      );
    });
    codeIndex++;
    codeLang = null;
    codeBuf = [];
  };

  const emit = (key2: string, prefix: Span | null, body: Span[], contPrefix?: string) => {
    if (produced > maxBody) {
      truncated = true;
      return;
    }
    const prefixW = prefix ? width(prefix.text) : 0;
    const wrapped = wrapSpans(body, avail - prefixW);
    wrapped.forEach((spans, idx) => {
      if (produced > maxBody) {
        truncated = true;
        return;
      }
      const usePrefix =
        idx === 0
          ? prefix
          : contPrefix
            ? span(contPrefix, prefix ? { color: prefix.color, bold: false } : {})
            : span(" ".repeat(prefixW));
      push(
        row(
          `${key2}:${idx}:${produced++}`,
          <Text wrap="truncate-end">
            <Text>{PAD}</Text>
            {usePrefix ? renderSpans([usePrefix], key2) : null}
            {renderSpans(spans, key2 + ":s")}
          </Text>,
        ),
      );
    });
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s*```+\s*(.*)$/.exec(line);
    if (fence) {
      if (codeLang === null) {
        codeLang = fence[1]!.trim();
        codeBuf = [];
      } else {
        flushCode();
      }
      i++;
      continue;
    }
    if (codeLang !== null) {
      codeBuf.push(line);
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const spans = parseInline(heading[2]!, t).map((s) => ({
        ...s,
        color: t.accent,
        bold: true,
      }));
      emit(`${key}:h${i}`, null, spans);
      i++;
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      push(
        row(
          `${key}:hr${i}`,
          <Text wrap="truncate-end">
            <Text color={t.borderFaint}>{PAD + "─".repeat(Math.max(0, avail))}</Text>
          </Text>,
        ),
      );
      i++;
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      emit(
        `${key}:b${i}`,
        span("• ", { color: t.accent }),
        parseInline(bullet[2]!, t),
        "  ",
      );
      i++;
      continue;
    }
    const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      emit(
        `${key}:n${i}`,
        span(`${numbered[2]}. `, { color: t.accent }),
        parseInline(numbered[3]!, t),
        " ".repeat(numbered[2]!.length + 2),
      );
      i++;
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      emit(
        `${key}:q${i}`,
        span("▏ ", { color: t.borderActive }),
        parseInline(quote[1]!, t).map((s) => ({ ...s, dim: true })),
        "  ",
      );
      i++;
      continue;
    }
    if (line.trim() === "") {
      push(blank(`${key}:e${i}`));
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      emit(`${key}:tbl${i}`, null, [span(line.trim(), { color: t.textDim })]);
      i++;
      continue;
    }
    emit(`${key}:l${i}`, null, parseInline(line, t));
    i++;
  }
  if (codeLang !== null) flushCode();

  if (truncated) {
    push(
      row(
        `${key}:trunc`,
        <Text color={t.muted} dimColor>
          <Text color={t.borderFaint}>{PAD}</Text>
          {"… output truncated · /compact to see more"}
        </Text>,
      ),
    );
  }
}

// ── small helpers ───────────────────────────────────────────────────────────

function row(key: string, children: React.ReactNode): React.ReactNode {
  return (
    <Text key={key} wrap="truncate-end">
      {children}
    </Text>
  );
}

function blank(key: string): React.ReactNode {
  return <Text key={key}> </Text>;
}

function previewArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  try {
    const json = JSON.stringify(args);
    if (!json || json === "{}") return "";
    return truncate(json, 120);
  } catch {
    return "";
  }
}
