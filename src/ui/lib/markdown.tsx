import React from "react";
import { Text } from "ink";
import { width } from "./text";
import type { Theme } from "../theme";

/** A styled run of text within a single visual line. */
export interface Span {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  dim?: boolean;
}

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;

/** Parse a line of markdown-ish text into styled spans. */
export function parseInline(line: string, theme: Theme): Span[] {
  const spans: Span[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(line)) !== null) {
    if (m.index > last) spans.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) {
      spans.push({ text: m[1], color: theme.accentBright });
    } else if (m[2] !== undefined) {
      spans.push({ text: m[2], bold: true, color: theme.text });
    } else if (m[3] !== undefined) {
      spans.push({ text: m[3], italic: true, color: theme.textDim });
    } else if (m[4] !== undefined) {
      spans.push({ text: m[4], color: theme.info });
    }
    last = INLINE.lastIndex;
  }
  if (last < line.length) spans.push({ text: line.slice(last) });
  if (spans.length === 0) spans.push({ text: "" });
  return spans;
}

/** Break spans into whitespace-preserving atoms for width-aware wrapping. */
function toAtoms(spans: Span[]): Span[] {
  const atoms: Span[] = [];
  for (const span of spans) {
    const parts = span.text.split(/(\s+)/);
    for (const part of parts) {
      if (part === "") continue;
      atoms.push({ ...span, text: part });
    }
  }
  return atoms;
}

/** Greedy word-wrap of styled spans to `max` visual columns. */
export function wrapSpans(spans: Span[], max: number): Span[][] {
  const limit = Math.max(1, max);
  const atoms = toAtoms(spans);
  const lines: Span[][] = [];
  let line: Span[] = [];
  let lineW = 0;

  const push = () => {
    lines.push(line);
    line = [];
    lineW = 0;
  };

  const append = (span: Span, text: string) => {
    const lastSpan = line[line.length - 1];
    if (
      lastSpan &&
      lastSpan.color === span.color &&
      lastSpan.bold === span.bold &&
      lastSpan.italic === span.italic &&
      lastSpan.dim === span.dim
    ) {
      lastSpan.text += text;
    } else {
      line.push({ ...span, text });
    }
    lineW += width(text);
  };

  for (const atom of atoms) {
    const isSpace = /^\s+$/.test(atom.text);
    const w = width(atom.text);

    if (isSpace) {
      if (lineW === 0) continue;
      if (lineW + 1 > limit) {
        push();
        continue;
      }
      append(atom, " ");
      continue;
    }

    if (lineW > 0 && lineW + w > limit) push();

    if (w <= limit) {
      append(atom, atom.text);
      continue;
    }

    // Atom longer than the line: hard-split it by column.
    let rest = atom.text;
    while (rest.length > 0) {
      let chunk = "";
      let chunkW = 0;
      for (const ch of rest) {
        const cw = width(ch);
        if (chunkW + cw > limit) break;
        chunk += ch;
        chunkW += cw;
      }
      append(atom, chunk);
      rest = rest.slice(chunk.length);
      if (rest.length > 0) push();
    }
  }
  if (line.length > 0 || lines.length === 0) lines.push(line);
  return lines;
}

/** Render spans as Ink text nodes. */
export function renderSpans(spans: Span[], keyPrefix: string): React.ReactNode {
  return spans.map((span, i) => (
    <Text
      key={`${keyPrefix}:${i}`}
      color={span.color}
      bold={span.bold}
      italic={span.italic}
      dimColor={span.dim}
    >
      {span.text}
    </Text>
  ));
}

/** Neutral span helper. */
export function span(text: string, style: Partial<Span> = {}): Span {
  return { text, ...style };
}
