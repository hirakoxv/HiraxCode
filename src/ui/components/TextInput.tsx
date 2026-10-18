import { Text, useInput } from "ink";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { sanitizeInput } from "../lib/input";
import { width as displayWidth } from "../lib/text";

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  /** Whether this field listens to keys. Defaults to true. */
  focus?: boolean;
  /** When set, the value is rendered as this character repeated. */
  mask?: string;
  /** Show the block cursor. Defaults to true. */
  showCursor?: boolean;
  /**
   * Available columns for the field. When the value is wider it scrolls
   * horizontally (with a leading `…`) instead of wrapping, so a single-line
   * field can never spill out of its box.
   */
  width?: number;
}

interface Cell {
  ch: string;
  w: number;
  cursor: boolean;
}

/**
 * A controlled single-line text field.
 *
 * Drop-in replacement for `ink-text-input`, with one crucial difference: every
 * keystroke is passed through {@link sanitizeInput} first, so raw escape bytes
 * (mouse reports, bracketed-paste markers, stray control characters) can never
 * end up in the value. It also implements proper cursor movement.
 *
 * The field is guaranteed to render on exactly one line: embedded newlines are
 * folded to spaces and overflow scrolls horizontally.
 */
export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder = "",
  focus = true,
  mask,
  showCursor = true,
  width: fieldWidth,
}: TextInputProps) {
  const safeValue = value ?? "";
  const [cursor, setCursor] = useState(safeValue.length);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  // Clamp the cursor when the value shrinks from the outside.
  useEffect(() => {
    setCursor((c) => Math.min(c, safeValue.length));
  }, [safeValue]);

  useInput(
    (input, key) => {
      // Keys owned by the app shell or other widgets.
      if (key.tab || key.upArrow || key.downArrow) return;
      if (key.ctrl && input === "c") return;

      const len = safeValue.length;
      const off = Math.max(0, Math.min(cursorRef.current, len));

      if (key.return) {
        onSubmit?.(safeValue);
        return;
      }

      if (key.ctrl && input === "a") return setCursor(0);
      if (key.ctrl && input === "e") return setCursor(len);
      if (key.ctrl && input === "u") {
        onChange(safeValue.slice(off));
        return setCursor(0);
      }
      if (key.ctrl && input === "k") {
        onChange(safeValue.slice(0, off));
        return;
      }
      if (key.ctrl && input === "w") {
        const left = safeValue.slice(0, off).replace(/\S*\s*$/, "");
        onChange(left + safeValue.slice(off));
        return setCursor(left.length);
      }

      if (key.leftArrow) return setCursor(Math.max(0, off - 1));
      if (key.rightArrow) return setCursor(Math.min(len, off + 1));

      if (key.backspace || key.delete) {
        if (off === 0) return;
        onChange(safeValue.slice(0, off - 1) + safeValue.slice(off));
        return setCursor(off - 1);
      }

      // Plain text — scrub escape sequences before inserting anything. Any
      // remaining ctrl/meta combo belongs to the app shell (ctrl+b, ctrl+v, …).
      if (key.ctrl || key.meta) return;
      const clean = sanitizeInput(input);
      if (!clean) return;
      onChange(safeValue.slice(0, off) + clean + safeValue.slice(off));
      setCursor(off + clean.length);
    },
    { isActive: focus },
  );

  const maxW = fieldWidth && fieldWidth > 0 ? fieldWidth : 0;
  const raw = mask ? mask.repeat(safeValue.length) : safeValue;

  if (raw.length === 0) {
    if (!placeholder) {
      return showCursor && focus ? <Text inverse> </Text> : <Text> </Text>;
    }
    // A placeholder is decorative: clip it to the field, never wrap.
    const text = maxW > 0 ? clip(placeholder, maxW) : placeholder;
    const [first, ...rest] = [...text];
    return (
      <Text wrap="truncate-end">
        {showCursor && focus ? <Text inverse>{first}</Text> : first}
        <Text color="grey">{rest.join("")}</Text>
      </Text>
    );
  }

  // `cursor` is a UTF-16 offset (it matches `slice`/`length`), but we render by
  // code point so astral characters (emoji) stay intact. Translate the offset.
  const chars = [...raw];
  let pos = 0;
  for (let u = 0; u < cursor && pos < chars.length; pos++) {
    u += chars[pos]!.length;
  }

  // One cell per code point (plus a trailing cursor cell). Fold any embedded
  // newline to a space so the box always stays a single line.
  let cells: Cell[] = chars.map((ch, i) => ({
    ch: ch === "\n" || ch === "\r" ? " " : ch,
    w: Math.max(0, displayWidth(ch === "\n" || ch === "\r" ? " " : ch)),
    cursor: i === pos && showCursor && focus,
  }));
  if (pos >= chars.length && showCursor && focus) {
    cells.push({ ch: " ", w: 1, cursor: true });
  }

  // Horizontal scroll: keep the cursor in view, marking hidden text with `…`.
  if (maxW > 0) {
    const totalW = cells.reduce((a, c) => a + c.w, 0);
    if (totalW > maxW) {
      const cursorIdx = Math.max(0, cells.findIndex((c) => c.cursor));
      let start = 0;
      // Walk the window forward until the cursor fits (reserving a column for
      // the leading ellipsis once anything is hidden on the left).
      while (start < cursorIdx) {
        const budget = maxW - (start > 0 ? 1 : 0);
        let used = 0;
        let visible = false;
        for (let i = start; i < cells.length; i++) {
          if (used + cells[i]!.w > budget) break;
          used += cells[i]!.w;
          if (i === cursorIdx) {
            visible = true;
            break;
          }
        }
        if (visible) break;
        start++;
      }

      const budget = maxW - (start > 0 ? 1 : 0);
      const out: Cell[] = [];
      let used = 0;
      for (let i = start; i < cells.length; i++) {
        if (used + cells[i]!.w > budget) break;
        out.push(cells[i]!);
        used += cells[i]!.w;
      }
      if (start > 0) out.unshift({ ch: "…", w: 1, cursor: false });
      cells = out;
    }
  }

  const nodes: ReactNode[] = cells.map((cell, i) =>
    cell.cursor ? (
      <Text key={i} inverse>
        {cell.ch}
      </Text>
    ) : (
      cell.ch
    ),
  );

  return <Text wrap="truncate-end">{nodes}</Text>;
}

/** Clip a plain string to `max` columns, appending `…` when shortened. */
function clip(text: string, max: number): string {
  if (displayWidth(text) <= max) return text;
  let out = "";
  let used = 0;
  for (const ch of [...text]) {
    const cw = Math.max(0, displayWidth(ch));
    if (used + cw > max - 1) break;
    out += ch;
    used += cw;
  }
  return out + "…";
}
