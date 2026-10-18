import { existsSync } from "fs";
import { homedir, platform } from "os";
import { resolve } from "path";
import { ensureBinary, LLAMA_SERVER_SPEC } from "@/utils/binaries";
import { logger } from "@/utils/logger";
import { findFreePort, sleep, spawn, which } from "@/utils/runtime";

export interface LlamaServerHandle {
  baseUrl: string;
  port: number;
  pid: number;
  stop(): void;
}

interface RunningServer extends LlamaServerHandle {
  ggufPath: string;
  /** Everything that must match before we reuse a running instance. */
  sig: string;
}

let running: RunningServer | null = null;

/** Locate the llama-server binary. */
export function findLlamaBin(bin = "llama-server"): string | null {
  if (bin.includes("/") || bin.includes("\\")) {
    const p = resolve(bin);
    return existsSync(p) ? p : null;
  }
  const exe = platform() === "win32" && !bin.toLowerCase().endsWith(".exe") ? `${bin}.exe` : bin;
  const found = which(exe) ?? which(bin);
  if (found) return found;
  return null;
}

function joinSafe(...parts: (string | undefined)[]): string | undefined {
  const clean = parts.filter((p): p is string => !!p);
  if (clean.length === 0) return undefined;
  return resolve(clean[0]!, ...clean.slice(1));
}

async function freePort(preferred: number): Promise<number> {
  try {
    return await findFreePort(preferred);
  } catch {
    throw new Error("No free port found for llama.cpp server");
  }
}

async function waitForHealth(port: number, timeoutMs = 300_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { status?: string };
        if (!body.status || body.status === "ok") return true;
      }
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  return false;
}

/**
 * Ensure a llama.cpp server is running for the given .gguf file.
 * Reuses an already-running instance for the same file.
 */
export interface LlamaServerOptions {
  ggufPath: string;
  bin?: string;
  ctxSize?: number;
  port?: number;
  threads?: number;
  parallel?: number;
  ubatch?: number;
  temp?: number;
  keepAlive?: string;
  /** multimodal projector path — enables vision for the loaded model */
  mmproj?: string;
  /** Jinja2 chat template (needed for tool calling). Default true. */
  jinja?: boolean;
  extra?: string[];
  onLog?: (line: string) => void;
  autoDownload?: boolean;
}

/**
 * Build the llama-server argv for a given binary/port.
 * Exported so the flags can be unit-tested without spawning a server.
 */
export function buildLlamaServerArgs(bin: string, port: number, opts: LlamaServerOptions): string[] {
  const args = [
    bin,
    "-m",
    opts.ggufPath,
    "-c",
    String(opts.ctxSize ?? 8192),
    "--port",
    String(port),
    "--host",
    "127.0.0.1",
  ];
  if (opts.threads) args.push("-t", String(opts.threads));
  if (opts.parallel) args.push("--parallel", String(opts.parallel));
  if (opts.ubatch) args.push("-ub", String(opts.ubatch));
  if (opts.temp !== undefined) args.push("--temp", String(opts.temp));
  if (opts.keepAlive) args.push("--keep", opts.keepAlive);
  if (opts.mmproj) args.push("--mmproj", opts.mmproj);

  // HiraxCode always sends `tools`, and llama-server rejects that unless it was
  // started with --jinja (Jinja2 chat-template + tool-call support). Honour an
  // explicit --jinja in the user's extra args instead of duplicating it.
  const extra = opts.extra ?? [];
  const jinjaDisabled = extra.includes("--no-jinja") || extra.includes("--jinja=false");
  if ((opts.jinja ?? true) && !jinjaDisabled && !extra.includes("--jinja")) {
    args.push("--jinja");
  }
  if (extra.length) args.push(...extra);
  return args;
}

export async function ensureLlamaServer(
  opts: LlamaServerOptions,
): Promise<LlamaServerHandle> {
  const { ggufPath } = opts;

  if (!ggufPath || !existsSync(ggufPath)) {
    throw new Error(`GGUF file not found: ${ggufPath || "(empty)"}. Set it in settings (/settings).`);
  }

  const sig = [
    resolve(ggufPath),
    opts.mmproj ? resolve(opts.mmproj) : "",
    (opts.jinja ?? true) ? "jinja" : "",
    (opts.extra ?? []).join(" "),
  ].join("|");
  if (running && running.sig === sig) return running;

  let bin = findLlamaBin(opts.bin || "llama-server");
  if (!bin && (opts.autoDownload ?? true)) {
    try {
      bin = await ensureBinary(LLAMA_SERVER_SPEC);
    } catch (e) {
      logger.error("auto-download llama-server failed", e);
    }
  }
  if (!bin) {
    throw new Error(
      "llama-server not found. Install llama.cpp or enable auto-download by using GGUF provider.",
    );
  }

  const port = await freePort(opts.port ?? 8181);

  const args = buildLlamaServerArgs(bin, port, opts);

  const proc = spawn(args, { stdout: "pipe", stderr: "pipe" });

  if (opts.onLog) {
    void pipeLines(proc.stdout, opts.onLog);
    void pipeLines(proc.stderr, opts.onLog);
  }

  logger.info("starting llama-server", bin, ggufPath, "port", port);

  const ok = await waitForHealth(port);
  if (!ok) {
    proc.kill();
    throw new Error("llama.cpp server did not become healthy in time.");
  }

  const handle: RunningServer = {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    port,
    pid: proc.pid,
    ggufPath: resolve(ggufPath),
    sig,
    stop: () => {
      try {
        proc.kill();
      } catch {}
      if (running?.port === port) running = null;
    },
  };

  running = handle;
  return handle;
}

export function stopLlamaServer(): void {
  running?.stop();
  running = null;
}

async function pipeLines(
  stream: ReadableStream<Uint8Array> | null,
  onLine: (line: string) => void,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onLine(line.trim());
    }
  } catch {
    // stream closed
  }
}
