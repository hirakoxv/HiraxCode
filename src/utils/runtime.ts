/**
 * Runtime helpers that work on plain Node.js — no Bun required.
 *
 * HiraxCode used to lean on Bun globals (`Bun.spawn`, `Bun.which`, `Bun.serve`,
 * `Bun.sleep`, `Bun.Glob`). Everything Node-flavoured lives here so the rest of
 * the app stays runtime-agnostic. Child process stdout/stderr are exposed as
 * web `ReadableStream`s, matching what the call sites already expect.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { statSync } from "node:fs";
import { createServer } from "node:net";
import { platform } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";

/** Resolve after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Locate an executable on `PATH`, honouring `PATHEXT` on Windows.
 * Returns the absolute path, or `null` when not found.
 */
export function which(cmd: string): string | null {
  if (!cmd) return null;

  // An explicit path (contains a separator) is checked as-is.
  if (cmd.includes("/") || cmd.includes("\\")) {
    const p = isAbsolute(cmd) ? cmd : resolve(cmd);
    return isFile(p) ? p : null;
  }

  const win = platform() === "win32";
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = win
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const lower = cmd.toLowerCase();
  const hasExt = win && exts.some((e) => lower.endsWith(e.toLowerCase()));

  for (const dir of dirs) {
    // On Windows try each PATHEXT suffix first, then the bare name.
    const names = hasExt ? [cmd] : win ? [...exts.map((e) => cmd + e), cmd] : [cmd];
    for (const name of names) {
      const candidate = join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: "pipe" | "ignore";
  stdout?: "pipe" | "ignore";
  stderr?: "pipe" | "ignore";
}

export interface ByteWriter {
  write(chunk: Uint8Array | string): void;
  end(): void;
}

export interface SpawnedProcess {
  pid: number;
  stdin: ByteWriter | null;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  /** Resolves with the exit code once the process is done. */
  exited: Promise<number>;
  kill(): void;
}

function pipe(
  stream: NodeJS.ReadableStream | null,
): ReadableStream<Uint8Array> | null {
  if (!stream) return null;
  return Readable.toWeb(stream as Readable) as unknown as ReadableStream<Uint8Array>;
}

/**
 * Spawn a process. Mirrors the slice of `Bun.spawn` this app uses: string
 * stdio modes, optional `cwd`/`env`, web-stream stdout/stderr and `exited`.
 */
export function spawn(argv: string[], opts: SpawnOptions = {}): SpawnedProcess {
  const [file, ...args] = argv;
  if (!file) throw new Error("spawn: empty argv");

  const child = nodeSpawn(file, args, {
    cwd: opts.cwd,
    env: opts.env as NodeJS.ProcessEnv | undefined,
    stdio: [
      opts.stdin === "pipe" ? "pipe" : "ignore",
      opts.stdout === "pipe" ? "pipe" : "ignore",
      opts.stderr === "pipe" ? "pipe" : "ignore",
    ],
  });

  const exited = new Promise<number>((settle) => {
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      settle(code);
    };
    child.on("error", () => finish(1));
    child.on("close", (code) => finish(code ?? 0));
  });

  const stdin: ByteWriter | null =
    opts.stdin === "pipe" && child.stdin
      ? {
          write: (chunk) => {
            try {
              child.stdin?.write(chunk);
            } catch {}
          },
          end: () => {
            try {
              child.stdin?.end();
            } catch {}
          },
        }
      : null;

  return {
    pid: child.pid ?? 0,
    stdin,
    stdout: pipe(child.stdout),
    stderr: pipe(child.stderr),
    exited,
    kill: () => {
      try {
        child.kill();
      } catch {}
    },
  };
}

/**
 * First free TCP port at or after `preferred` (probing up to `tries` ports).
 * Replaces the old "start a throwaway server and hope it binds" trick.
 */
export function findFreePort(preferred: number, tries = 40): Promise<number> {
  return new Promise((settle, reject) => {
    let port = preferred;
    const attempt = () => {
      if (port >= preferred + tries) {
        reject(new Error("No free port found"));
        return;
      }
      const server = createServer();
      let settled = false;
      server.once("error", () => {
        if (settled) return;
        settled = true;
        server.close();
        port += 1;
        attempt();
      });
      server.once("listening", () => {
        if (settled) return;
        settled = true;
        server.close(() => settle(port));
      });
      server.listen(port, "127.0.0.1");
    };
    attempt();
  });
}
