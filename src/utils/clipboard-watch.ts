/**
 * Clipboard watcher.
 *
 * On Windows the copy/paste keys never reach a TUI: Windows Terminal and the
 * VS Code integrated terminal both bind Ctrl+V to their own text paste, so the
 * app cannot see the keypress and cannot read the bitmap. Polling is the only
 * reliable way to notice a fresh screenshot.
 *
 * A single long-lived PowerShell process watches the clipboard and writes one
 * `IMG <base64-png>` line whenever the image changes. The clipboard as it was
 * when the watcher started is seeded as "already seen", so launching HiraxCode
 * never attaches whatever happened to be copied beforehand.
 *
 * Only Windows needs this; on macOS and Linux Ctrl+V reaches the app directly.
 */
import { platform } from "os";
import type { ClipImage } from "./clipboard";
import { logger } from "./logger";
import { spawn, which } from "./runtime";

/** Line protocol: `IMG <base64>`. Anything else is ignored. */
export function parseWatchLine(line: string): ClipImage | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("IMG ")) return null;
  const data = trimmed.slice(4);
  // A 1x1 PNG is already ~90 chars of base64; anything shorter is a split read.
  if (data.length < 64 || data.length > 40 * 1024 * 1024) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  return { mime: "image/png", data };
}

/** NuGet-free PowerShell: hash the clipboard image, print it only when it changed. */
const WATCH_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  "$sha = [System.Security.Cryptography.SHA1]::Create()",
  "function Snap {",
  "  try {",
  "    if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { return '' }",
  "    $img = [System.Windows.Forms.Clipboard]::GetImage()",
  "    if ($null -eq $img) { return '' }",
  "    $ms = New-Object System.IO.MemoryStream",
  "    $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
  "    $bytes = $ms.ToArray()",
  "    return [System.BitConverter]::ToString($sha.ComputeHash($bytes)) + '|' + [Convert]::ToBase64String($bytes)",
  "  } catch { return '' }",
  "}",
  "$last = ''",
  "$seed = Snap",
  "if ($seed) { $last = $seed.Substring(0, $seed.IndexOf('|')) }",
  "while ($true) {",
  "  $s = Snap",
  "  if ($s) {",
  "    $i = $s.IndexOf('|')",
  "    $hash = $s.Substring(0, $i)",
  "    if ($hash -ne $last) {",
  "      $last = $hash",
  "      [Console]::Out.WriteLine('IMG ' + $s.Substring($i + 1))",
  "      [Console]::Out.Flush()",
  "    }",
  "  }",
  "  Start-Sleep -Milliseconds 600",
  "}",
].join("\n");

export interface ClipboardWatcher {
  stop(): void;
}

const live = new Set<ClipboardWatcher>();

/** Stop every watcher — used on process exit so no PowerShell is left behind. */
export function stopAllWatchers(): void {
  for (const watcher of [...live]) {
    try {
      watcher.stop();
    } catch {}
  }
  live.clear();
}

/** True when background clipboard watching is available on this host. */
export function clipboardWatchSupported(): boolean {
  if (process.env.HIRAX_NO_CLIPBOARD_WATCH === "1") return false;
  return platform() === "win32" && Boolean(which("powershell.exe") ?? which("pwsh.exe"));
}

/**
 * Watch the clipboard and call `onImage` for every *new* image. Returns a
 * handle; calling `stop()` terminates the helper process.
 */
export function startClipboardWatch(onImage: (img: ClipImage) => void): ClipboardWatcher {
  const noop: ClipboardWatcher = { stop() {} };
  if (!clipboardWatchSupported()) return noop;

  const shell = which("powershell.exe") ?? which("pwsh.exe");
  if (!shell) return noop;

  let stopped = false;
  const proc = spawn(
    [shell, "-NoProfile", "-NonInteractive", "-STA", "-Command", WATCH_SCRIPT],
    { stdout: "pipe", stderr: "ignore" },
  );

  const watcher: ClipboardWatcher = {
    stop() {
      stopped = true;
      live.delete(watcher);
      try {
        proc.kill();
      } catch {}
    },
  };
  live.add(watcher);

  void (async () => {
    const stdout = proc.stdout;
    if (!stdout) return;
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (stopped) return;
          const img = parseWatchLine(line);
          if (img) {
            try {
              onImage(img);
            } catch (e) {
              logger.debug("clipboard watcher handler failed", e);
            }
          }
        }
      }
    } catch (e) {
      if (!stopped) logger.debug("clipboard watcher stopped", e);
    } finally {
      watcher.stop();
    }
  })();

  return watcher;
}
