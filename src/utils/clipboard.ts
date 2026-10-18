import { platform } from "os";
import { existsSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { nanoid } from "nanoid";
import { logger } from "./logger";

export interface ClipImage {
  mime: string;
  /** base64 data, no `data:` prefix */
  data: string;
}

async function run(
  cmd: string[],
  stdinBytes?: Uint8Array,
): Promise<{ code: number; stdout: Uint8Array }> {
  const proc = Bun.spawn(cmd, {
    stdin: stdinBytes ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  if (stdinBytes) {
    proc.stdin?.write(stdinBytes);
    proc.stdin?.end();
  }
  const stdout = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  const code = await proc.exited;
  return { code, stdout };
}

const PS_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  "$img = [System.Windows.Forms.Clipboard]::GetImage()",
  "if ($null -eq $img) { exit 3 }",
  "$ms = New-Object System.IO.MemoryStream",
  "$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
  "[Convert]::ToBase64String($ms.ToArray())",
].join("; ");

async function readWindows(): Promise<ClipImage | null> {
  // Windows PowerShell 5.1 runs STA by default, which the clipboard API needs.
  for (const shell of ["powershell.exe", "pwsh.exe", "powershell", "pwsh"]) {
    try {
      const { code, stdout } = await run([
        shell,
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-Command",
        PS_SCRIPT,
      ]);
      if (code === 3) return null; // clipboard has no image
      if (code !== 0) continue;
      const b64 = new TextDecoder().decode(stdout).trim();
      if (!b64) return null;
      return { mime: "image/png", data: b64 };
    } catch {
      // try next shell
    }
  }
  return null;
}

async function readMac(): Promise<ClipImage | null> {
  // Prefer pngpaste if the user has it (brew install pngpaste).
  try {
    const { code, stdout } = await run(["pngpaste", "-"]);
    if (code === 0 && stdout.length > 0) {
      return { mime: "image/png", data: Buffer.from(stdout).toString("base64") };
    }
  } catch {
    // not installed
  }

  // Fallback: AppleScript writes the clipboard PNG to a temp file.
  const file = join(tmpdir(), `hirax-clip-${nanoid(8)}.png`);
  const script = [
    "set pngData to the clipboard as «class PNGf»",
    `set outFile to open for access POSIX file "${file}" with write permission`,
    "set eof outFile to 0",
    "write pngData to outFile",
    "close access outFile",
  ].join("\n");
  try {
    const { code } = await run(["osascript", "-e", script]);
    if (code === 0 && existsSync(file)) {
      const data = readFileSync(file).toString("base64");
      return { mime: "image/png", data };
    }
  } catch {
    // no image on clipboard
  } finally {
    try {
      rmSync(file, { force: true });
    } catch {}
  }
  return null;
}

async function readLinux(): Promise<ClipImage | null> {
  const wayland = !!process.env.WAYLAND_DISPLAY;
  const attempts: string[][] = wayland
    ? [
        ["wl-paste", "--no-newline", "--type", "image/png"],
        ["xclip", "-selection", "clipboard", "-t", "image/png", "-o"],
      ]
    : [
        ["xclip", "-selection", "clipboard", "-t", "image/png", "-o"],
        ["wl-paste", "--no-newline", "--type", "image/png"],
      ];

  for (const cmd of attempts) {
    try {
      const { code, stdout } = await run(cmd);
      if (code === 0 && stdout.length > 0) {
        return { mime: "image/png", data: Buffer.from(stdout).toString("base64") };
      }
    } catch {
      // tool not installed
    }
  }
  return null;
}

/**
 * Read an image from the system clipboard.
 * Works on Windows, macOS and Linux (X11 + Wayland). Returns null when the
 * clipboard holds no image or no supported clipboard tool is available.
 */
export async function readClipboardImage(): Promise<ClipImage | null> {
  try {
    const os = platform();
    if (os === "win32") return await readWindows();
    if (os === "darwin") return await readMac();
    return await readLinux();
  } catch (e) {
    logger.debug("readClipboardImage failed", e);
    return null;
  }
}

/** True when the host OS has a clipboard reader we know how to drive. */
export function clipboardSupported(): boolean {
  const os = platform();
  if (os === "win32" || os === "darwin") return true;
  return !!Bun.which("xclip") || !!Bun.which("wl-paste");
}

/** Approximate decoded size in bytes. */
export function imageBytes(img: ClipImage): number {
  return Math.floor((img.data.length * 3) / 4);
}

// ── files on the clipboard & on disk ────────────────────────────────────────

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/** The image MIME type for a path, or undefined when it isn't an image. */
export function imageMimeFor(file: string): string | undefined {
  const ext = file.toLowerCase().split(".").pop() ?? "";
  return IMAGE_MIME[ext];
}

/** Read an image file from disk (base64, no `data:` prefix). */
export function readImageFile(file: string): ClipImage | null {
  try {
    const mime = imageMimeFor(file);
    if (!mime || !existsSync(file)) return null;
    const st = statSync(file);
    if (!st.isFile() || st.size === 0 || st.size > 25 * 1024 * 1024) return null;
    return { mime, data: readFileSync(file).toString("base64") };
  } catch (e) {
    logger.debug("readImageFile failed", e);
    return null;
  }
}

/**
 * Every existing image file referenced in `text` — handy for the paths that
 * terminals insert when you drag-and-drop (or paste) a file.
 */
export function imagesInText(
  text: string,
): Array<{ path: string; image: ClipImage }> {
  const tokens = new Set<string>();
  for (const m of text.matchAll(/"([^"]+)"|'([^']+)'/g)) {
    tokens.add((m[1] ?? m[2])!.trim());
  }
  for (const raw of text.split(/\s+/)) {
    tokens.add(raw.replace(/^["']+|["']+$/g, "").trim());
  }
  const out: Array<{ path: string; image: ClipImage }> = [];
  for (const token of tokens) {
    if (!token || !imageMimeFor(token) || !existsSync(token)) continue;
    const image = readImageFile(token);
    if (image) out.push({ path: token, image });
  }
  return out;
}

/** Display name for a file path (used as an attachment label). */
export function fileName(file: string): string {
  return basename(file) || file;
}

const PS_FILES = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$files = [System.Windows.Forms.Clipboard]::GetFileDropList()",
  "if ($null -eq $files -or $files.Count -eq 0) { exit 3 }",
  "$files | ForEach-Object { $_ }",
].join("; ");

async function readFilesWindows(): Promise<string[]> {
  for (const shell of ["powershell.exe", "pwsh.exe", "powershell", "pwsh"]) {
    try {
      const { code, stdout } = await run([
        shell,
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-Command",
        PS_FILES,
      ]);
      if (code === 3) return [];
      if (code !== 0) continue;
      return new TextDecoder()
        .decode(stdout)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      // try next shell
    }
  }
  return [];
}

async function readFilesMac(): Promise<string[]> {
  const script = [
    "try",
    "  set f to (the clipboard as «class furl»)",
    "  return POSIX path of f",
    "end try",
  ].join("\n");
  try {
    const { code, stdout } = await run(["osascript", "-e", script]);
    if (code === 0) {
      return new TextDecoder()
        .decode(stdout)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {
    // no file alias on the clipboard
  }
  return [];
}

async function readFilesLinux(): Promise<string[]> {
  const attempts: string[][] = [
    ["xclip", "-selection", "clipboard", "-t", "text/uri-list", "-o"],
    ["wl-paste", "--no-newline", "--list-types"],
  ];
  for (const cmd of attempts) {
    try {
      const { code, stdout } = await run(cmd);
      if (code !== 0) continue;
      const text = new TextDecoder().decode(stdout);
      if (cmd[0] === "wl-paste") break; // listing types doesn't give paths
      const paths = text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.startsWith("file://"))
        .map((s) => decodeURIComponent(s.replace(/^file:\/\//, "")));
      if (paths.length > 0) return paths;
    } catch {
      // tool not installed
    }
  }
  // Wayland: read the uri-list directly.
  try {
    const { code, stdout } = await run([
      "wl-paste",
      "--no-newline",
      "--type",
      "text/uri-list",
    ]);
    if (code === 0) {
      return new TextDecoder()
        .decode(stdout)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.startsWith("file://"))
        .map((s) => decodeURIComponent(s.replace(/^file:\/\//, "")));
    }
  } catch {
    // not available
  }
  return [];
}

/**
 * Absolute paths of files currently on the clipboard (best-effort, per OS).
 * Returns an empty array when the clipboard holds no files.
 */
export async function readClipboardFiles(): Promise<string[]> {
  try {
    const os = platform();
    if (os === "win32") return await readFilesWindows();
    if (os === "darwin") return await readFilesMac();
    return await readFilesLinux();
  } catch (e) {
    logger.debug("readClipboardFiles failed", e);
    return [];
  }
}
