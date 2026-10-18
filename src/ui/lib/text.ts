import stringWidth from "string-width";

/** Visual width of a string (accounts for wide/emoji chars, ignores ANSI). */
export function width(text: string): number {
  return stringWidth(text);
}

/** Truncate to `max` visual columns, appending an ellipsis when clipped. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (width(text) <= max) return text;
  if (max === 1) return "…";
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = width(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

/** Pad on the right to `max` columns (never truncates). */
export function padEnd(text: string, max: number): string {
  const w = width(text);
  return w >= max ? text : text + " ".repeat(max - w);
}

/** Pad on the left to `max` columns (never truncates). */
export function padStart(text: string, max: number): string {
  const w = width(text);
  return w >= max ? text : " ".repeat(max - w) + text;
}

/** Hard-wrap plain text to `max` columns, splitting long words. */
export function hardWrap(text: string, max: number): string[] {
  const limit = Math.max(1, max);
  const out: string[] = [];
  const words = text.split(/(\s+)/);
  let line = "";
  let lineW = 0;

  const push = () => {
    out.push(line);
    line = "";
    lineW = 0;
  };

  for (const token of words) {
    if (token === "") continue;
    const isSpace = /^\s+$/.test(token);
    if (isSpace) {
      if (lineW === 0) continue; // drop leading whitespace
      if (lineW + 1 > limit) {
        push();
        continue;
      }
      line += " ";
      lineW += 1;
      continue;
    }

    let token2 = token;
    // Split an over-long word across lines.
    while (width(token2) > limit) {
      if (lineW > 0) push();
      let chunk = "";
      let chunkW = 0;
      for (const ch of token2) {
        const cw = width(ch);
        if (chunkW + cw > limit) break;
        chunk += ch;
        chunkW += cw;
      }
      out.push(chunk);
      token2 = token2.slice(chunk.length);
    }
    if (lineW > 0 && lineW + width(token2) > limit) push();
    line += token2;
    lineW += width(token2);
  }
  if (line !== "" || out.length === 0) out.push(line);
  return out;
}

/** Wrap text to `max` columns, honouring existing newlines. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) out.push(...hardWrap(raw, max));
  return out;
}

/**
 * Wrap monospace/code text to `max` columns while preserving leading
 * whitespace (unlike {@link hardWrap}, which collapses indentation).
 */
export function wrapCode(text: string, max: number): string[] {
  const limit = Math.max(1, max);
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (width(raw) <= limit) {
      out.push(raw);
      continue;
    }
    let rest = raw;
    while (width(rest) > limit) {
      let chunk = "";
      let w = 0;
      for (const ch of rest) {
        const cw = width(ch);
        if (w + cw > limit) break;
        chunk += ch;
        w += cw;
      }
      out.push(chunk);
      rest = rest.slice(chunk.length);
    }
    out.push(rest);
  }
  return out;
}

/** Shorten a one-line path-ish string from the left, e.g. `…/src/ui/App.tsx`. */
export function middleEllipsis(text: string, max: number): string {
  if (width(text) <= max) return text;
  if (max <= 1) return "…";
  const half = Math.floor((max - 1) / 2);
  const start = takeWidth(text, half);
  const end = takeWidthFromEnd(text, max - 1 - width(start));
  return `${start}…${end}`;
}

function takeWidth(text: string, max: number): string {
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = width(ch);
    if (w + cw > max) break;
    out += ch;
    w += cw;
  }
  return out;
}

function takeWidthFromEnd(text: string, max: number): string {
  let out = "";
  let w = 0;
  const chars = [...text];
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = width(chars[i]!);
    if (w + cw > max) break;
    out = chars[i]! + out;
    w += cw;
  }
  return out;
}
