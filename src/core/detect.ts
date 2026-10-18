import { existsSync } from "fs";
import { homedir, platform } from "os";
import { resolve } from "path";

export interface LocalRuntime {
  ollama: { installed: boolean; running: boolean; baseUrl: string };
  lmstudio: { installed: boolean; running: boolean; baseUrl: string };
  llamacpp: { installed: boolean; running: boolean; baseUrl: string }; // llama.cpp server (manual)
  llamaServerBin: { found: boolean; path: string | null };
}

async function checkRunning(url: string, timeoutMs = 800): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

function whichSafe(bin: string): string | null {
  try {
    const r = Bun.which(bin);
    if (r) return r;
  } catch {}
  return null;
}

function joinSafe(...parts: (string | undefined)[]): string | undefined {
  const clean = parts.filter((p): p is string => !!p);
  if (clean.length === 0) return undefined;
  return resolve(clean[0]!, ...clean.slice(1));
}

export async function detectLocal(): Promise<LocalRuntime> {
  const p = platform();
  const home = homedir();

  // Ollama
  let ollamaInstalled = false;
  {
    const bins = ["ollama", "ollama.exe"];
    for (const b of bins) if (whichSafe(b)) { ollamaInstalled = true; break; }
    if (!ollamaInstalled && p === "win32") {
      const cands = [
        joinSafe(process.env.LOCALAPPDATA, "Programs", "Ollama", "Ollama.exe"),
        joinSafe(process.env.PROGRAMFILES, "Ollama", "Ollama.exe"),
        joinSafe(process.env["PROGRAMFILES(X86)"], "Ollama", "Ollama.exe"),
      ];
      ollamaInstalled = !!cands.some((c) => c && existsSync(c));
    }
    if (!ollamaInstalled && p === "darwin") {
      ollamaInstalled = existsSync("/Applications/Ollama.app");
    }
    if (!ollamaInstalled && p === "linux") {
      if (whichSafe("ollama")) ollamaInstalled = true;
      if (!ollamaInstalled) ollamaInstalled = existsSync(resolve(home, ".local", "bin", "ollama"));
    }
  }
  const ollamaRunning = await checkRunning("http://localhost:11434/v1/models");

  // LM Studio
  let lmstudioInstalled = false;
  {
    if (p === "win32") {
      const cands = [
        joinSafe(process.env.LOCALAPPDATA, "Programs", "LM Studio", "LM Studio.exe"),
        joinSafe(process.env.PROGRAMFILES, "LM Studio", "LM Studio.exe"),
        joinSafe(process.env["PROGRAMFILES(X86)"], "LM Studio", "LM Studio.exe"),
      ];
      lmstudioInstalled = !!cands.some((c) => c && existsSync(c));
    }
    if (p === "darwin") {
      lmstudioInstalled = existsSync("/Applications/LM Studio.app");
    }
    if (p === "linux") {
      lmstudioInstalled =
        existsSync(resolve(home, ".local", "share", "lm-studio", "lm-studio")) ||
        existsSync(resolve(home, ".local", "bin", "lm-studio")) ||
        existsSync("/usr/bin/lm-studio") ||
        existsSync("/usr/local/bin/lm-studio");
    }
    if (!lmstudioInstalled) {
      if (whichSafe("lm-studio") || whichSafe("lmstudio")) lmstudioInstalled = true;
    }
  }
  const lmstudioRunning = await checkRunning("http://localhost:1234/v1/models");

  // llama.cpp server (manual)
  let llamacppInstalled = false;
  {
    const bins = ["llama-server", "llama-server.exe"];
    for (const b of bins) if (whichSafe(b)) { llamacppInstalled = true; break; }
    if (!llamacppInstalled && p === "win32") {
      const cands = [
        joinSafe(process.env.LOCALAPPDATA, "Programs", "llama.cpp", "llama-server.exe"),
        joinSafe(process.env.LOCALAPPDATA, "Programs", "llama.cpp", "bin", "llama-server.exe"),
        joinSafe(home, "scoop", "apps", "llama.cpp", "current", "llama-server.exe"),
        joinSafe("C:\\Program Files", "llama.cpp", "llama-server.exe"),
      ];
      llamacppInstalled = !!cands.some((c) => c && existsSync(c));
    }
  }
  const llamacppRunning = await checkRunning("http://localhost:8080/v1/models");

  // llama-server binary for GGUF
  let llamaServerPath: string | null = null;
  {
    const bins = ["llama-server", "llama-server.exe"];
    for (const b of bins) {
      const f = whichSafe(b);
      if (f) { llamaServerPath = f; break; }
    }
    if (!llamaServerPath && p === "win32") {
      const cands = [
        joinSafe(process.env.LOCALAPPDATA, "Programs", "llama.cpp", "llama-server.exe"),
        joinSafe(home, "scoop", "apps", "llama.cpp", "current", "llama-server.exe"),
      ];
      for (const c of cands) if (c && existsSync(c)) { llamaServerPath = c; break; }
    }
  }

  return {
    ollama: { installed: ollamaInstalled, running: ollamaRunning, baseUrl: "http://localhost:11434/v1" },
    lmstudio: { installed: lmstudioInstalled, running: lmstudioRunning, baseUrl: "http://localhost:1234/v1" },
    llamacpp: { installed: llamacppInstalled, running: llamacppRunning, baseUrl: "http://localhost:8080/v1" },
    llamaServerBin: { found: !!llamaServerPath, path: llamaServerPath },
  };
}

export function bestLocalAuto(d: LocalRuntime): "ollama" | "lmstudio" | "llamacpp" | "gguf" | null {
  if (d.ollama.running) return "ollama";
  if (d.lmstudio.running) return "lmstudio";
  if (d.llamacpp.running) return "llamacpp";
  if (d.ollama.installed) return "ollama";
  if (d.lmstudio.installed) return "lmstudio";
  if (d.llamacpp.installed || d.llamaServerBin.found) return "gguf";
  return null;
}