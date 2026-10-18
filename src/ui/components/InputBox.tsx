import { Box, Text, useInput } from "ink";
import { useEffect, useState, type ReactNode } from "react";
import { TextInput } from "./TextInput";
import type { ApprovalRequest, MessageImage } from "@/core/types";
import { makeTheme, type Theme } from "../theme";
import { truncate, width } from "../lib/text";

export const INPUT_BASE_HEIGHT = 4; // prompt box (3 rows) + meta row
export const ATTACHMENT_HEIGHT = 1;
export const APPROVAL_HEIGHT = 7;

interface InputBoxProps {
  disabled?: boolean;
  focused: boolean;
  accent: string;
  value: string;
  onChange: (value: string) => void;
  /** Return false to reject (keeps the text so nothing is lost). */
  onSubmit: (value: string) => boolean | void;
  approval: ApprovalRequest | null;
  onApproval: (approved: boolean) => void;
  attachments: MessageImage[];
  /** Agent is running; the box stays editable but Enter queues the message. */
  busy?: boolean;
  /** Number of messages waiting in the queue. */
  queued?: number;
  theme?: Theme;
  width?: number;
  notice?: string | null;
  agentName?: string;
  model?: string;
  providerName?: string;
}

export function InputBox(props: InputBoxProps) {
  const t = props.theme ?? makeTheme(props.accent);
  const [local, setLocal] = useState(props.value);
  const cols = props.width ?? 80;

  // Keep local state in sync when the parent clears the input. Fold any stray
  // newline away so the single-line field can never break its box.
  useEffect(() => {
    setLocal(props.value.replace(/[\r\n]+/g, " "));
  }, [props.value]);

  if (props.approval) {
    return (
      <ApprovalPrompt
        request={props.approval}
        onDecide={props.onApproval}
        theme={t}
        width={cols}
      />
    );
  }

  const disabled = props.disabled ?? false;
  const busy = props.busy ?? false;
  const promptColor = disabled ? t.muted : props.focused ? t.accent : t.borderActive;
  const boxColor = props.focused ? t.accent : t.border;

  const meta = [props.agentName, props.model, props.providerName]
    .filter(Boolean)
    .join("  ");

  return (
    <Box flexDirection="column" width="100%" flexShrink={0}>
      {props.attachments.length > 0 && (
        <Box paddingX={1} width="100%">
          <Text color={t.accent}>{"▣ "}</Text>
          <Text color={t.text}>
            {props.attachments.length} image{props.attachments.length === 1 ? "" : "s"} attached
          </Text>
          <Text color={t.muted}>
            {"  "}
            {truncate(
              props.attachments.map((a) => a.name ?? "image").join(", "),
              Math.max(10, cols - 44),
            )}
            {" · /drop to remove"}
          </Text>
        </Box>
      )}

      <Box width="100%" paddingX={1}>
        <Box
          flexDirection="row"
          width="100%"
          borderStyle="round"
          borderColor={boxColor}
          paddingX={1}
        >
          <Text bold color={promptColor}>
            {"❯ "}
          </Text>
          {disabled ? (
            <Text color={t.muted}>working…</Text>
          ) : (
            <TextInput
              value={local}
              width={Math.max(6, cols - 8)}
              onChange={(v) => {
                setLocal(v);
                props.onChange(v);
              }}
              onSubmit={(v) => {
                const trimmed = v.trim();
                if (!trimmed) return;
                if (props.onSubmit(trimmed) === false) return;
                setLocal("");
                props.onChange("");
              }}
              placeholder="Type a message…"
              focus={props.focused && !disabled}
            />
          )}
        </Box>
      </Box>

      <Box paddingX={1} width="100%" justifyContent="space-between">
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          {props.notice ? (
            <Text wrap="truncate-end" color={t.warning}>{props.notice}</Text>
          ) : busy ? (
            <Text wrap="truncate-end" color={t.info}>
              {(props.queued ?? 0) > 0
                ? `working — ${props.queued} queued · keep typing to add more`
                : "working — enter queues the message"}
            </Text>
          ) : meta ? (
            <Text wrap="truncate-end">
              <Text bold color={t.accent}>
                {props.agentName ?? ""}
              </Text>
              {props.model ? <Text color={t.textDim}>{"  " + props.model}</Text> : null}
              {props.providerName ? (
                <Text color={t.muted}>{"  " + props.providerName}</Text>
              ) : null}
            </Text>
          ) : (
            <Text wrap="truncate-end" color={t.muted}>
              <Text color={t.textDim}>/</Text> commands ·{" "}
              <Text color={t.textDim}>tab</Text> sessions ·{" "}
              <Text color={t.textDim}>/paste</Text> image
            </Text>
          )}
        </Box>
        {local.length > 0 || props.attachments.length > 0 ? (
          <Box flexShrink={0}>
            <Text color={t.muted}>
              {"  "}
              {props.attachments.length > 0 ? "▣ " : ""}
              {local.length > 0 ? `${width(local)} chars` : ""}
            </Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function ApprovalPrompt({
  request,
  onDecide,
  theme: t,
  width: cols,
}: {
  request: ApprovalRequest;
  onDecide: (approved: boolean) => void;
  theme: Theme;
  width: number;
}) {
  useInput((input, key) => {
    const k = input.toLowerCase();
    if (key.escape || k === "n") {
      onDecide(false);
      return;
    }
    if (key.return || k === "y") {
      onDecide(true);
    }
  });

  const color = request.dangerous ? t.danger : t.accent;
  const inner = Math.max(16, cols - 4);

  const fit = (s: string, max: number) =>
    truncate(s.replace(/\s+/g, " ").trim(), Math.max(4, max));

  const row = (content: ReactNode, plain: string, key: string) => {
    const gap = Math.max(0, inner - width(plain));
    return (
      <Text key={key} wrap="truncate-end">
        {content}
        <Text>{" ".repeat(gap)}</Text>
      </Text>
    );
  };

  const title = request.dangerous ? "⚠ Approve dangerous action" : "◈ Approve tool call";
  const label = fit(`${title} · ${request.toolName}`, inner);
  const desc = fit(request.description, inner) || "(no description)";
  const argsRaw =
    request.toolName !== "run_bash" && Object.keys(request.args ?? {}).length > 0
      ? safeArgs(request.args)
      : "";
  const args = argsRaw ? fit(argsRaw, inner) : "";

  return (
    <Box flexDirection="column" width="100%" paddingX={1} height={APPROVAL_HEIGHT}>
      <Box
        flexDirection="column"
        width="100%"
        borderStyle="round"
        borderColor={color}
        paddingX={1}
      >
        <Text bold color={color} wrap="truncate-end">
          {label}
        </Text>
        {row(<Text color={t.text}>{desc}</Text>, desc, "desc")}
        {args ? row(<Text color={t.muted}>{args}</Text>, args, "args") : null}
        <Text>
          <Text bold color={t.success}>
            [y]
          </Text>
          <Text color={t.text}> allow</Text>
          <Text color={t.muted}>{"    "}</Text>
          <Text bold color={t.danger}>
            [n]
          </Text>
          <Text color={t.text}> deny</Text>
          <Text color={t.muted}>{"    "}esc cancel</Text>
        </Text>
      </Box>
    </Box>
  );
}

function safeArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args);
  } catch {
    return "";
  }
}
