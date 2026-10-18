import { logger } from "@/utils/logger";

export interface LocalProcessHandle {
  baseUrl: string;
  port: number;
  pid: number;
  stop(): void;
}

let running: LocalProcessHandle | null = null;

async function freePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 40; port++) {
    try {
      const s = Bun.serve({ port, fetch: () => new Response("") });
      s.stop(true);
      return port;
    } catch {}
  }
  throw new Error("No free port found");
}

async function waitForHealth(baseUrl: string, timeoutMs = 180_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {}
    await Bun.sleep(500);
  }
  return false;
}

function findBin(name: string): string | null {
  try {
    const r = Bun.which(name) || Bun.which(name + ".exe");
    if (r) return r;
  } catch {}
  return null;
}

export async function ensureOllamaRunning(opts: { port?: number; onLog?: (l: string) => void } = {}): Promise<LocalProcessHandle> {
  if (running) return running;
  let bin = findBin("ollama");
  if (!bin) {
    // Try common Windows paths
    const home = process.env.USERPROFILE || "";
    const cands = [
      `${process.env.LOCALAPPDATA}\\Programs\\Ollama\\Ollama.exe`,
      `${process.env.PROGRAMFILES}\\Ollama\\Ollama.exe`,
      `${home}\\AppData\\Local\\Programs\\Ollama\\Ollama.exe`,
    ];
    for (const c of cands) {
      try {
        const fs = await import("fs");
        if (fs.existsSync(c)) { bin = c; break; }
      } catch {}
    }
  }
  if (!bin) {
    throw new Error("ollama not found. HiraxCode tried to spawn it but it's not installed in PATH.");
  }
  const port = await freePort(opts.port ?? 11434);
  const host = "127.0.0.1";
  const env = { ...process.env, OLLAMA_HOST: `${host}:${port}`, OLLAMA_ORIGINS: "*" };
  const proc = Bun.spawn([bin, "serve"], { stdout: "pipe", stderr: "pipe", env });
  if (opts.onLog) {
    void (async () => {
      const dec = new TextDecoder();
      for (const s of [proc.stdout, proc.stderr]) {
        const r = s.getReader();
        try { while (true) { const res = await r.read(); if (res.done) break; opts.onLog!(dec.decode(res.value,{stream:true})); } } catch {}
      }
    })();
  }
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  const ok = await waitForHealth(baseUrl);
  if (!ok) { proc.kill(); throw new Error("ollama failed to start"); }
  running = { baseUrl, port, pid: proc.pid, stop: () => { try { proc.kill(); } catch {} if (running?.port===port) running=null; } };
  return running;
}