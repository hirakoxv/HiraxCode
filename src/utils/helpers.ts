import { homedir } from "os";
import stripAnsi from "strip-ansi";

export function truncate(text: string, max = 80): string {
  const clean = stripAnsi(text);
  if (clean.length <= max) return clean;
  return clean.slice(0, max) + "…";
}

/** Derive a short session title from the first user message. */
export function deriveTitle(content: string): string {
  const clean = stripAnsi(content).trim().replace(/\s+/g, " ");
  if (!clean) return "New Chat";
  return clean.length > 48 ? clean.slice(0, 48).trim() + "…" : clean;
}

/** Pretty-print a path, collapsing the home directory to ~ */
export function prettyPath(p: string): string {
  // homedir() works on Windows too; process.env.HOME is often unset there.
  const home = process.env.HOME || homedir();
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

export function safeStringify(value: unknown, max = 2000): string {
  try {
    const s = JSON.stringify(value, null, 2);
    return s.length > max ? s.slice(0, max) + "\n…" : s;
  } catch {
    return String(value);
  }
}

export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n… (${text.length - max} more chars)`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
