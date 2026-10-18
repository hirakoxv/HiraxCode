import { homedir, platform } from "os";
import { resolve } from "path";
import { existsSync } from "fs";
import { findLlamaBin } from "./llama";

export function getBuiltinLlamaCppPath(): string | null {
  const p = platform();
  const home = homedir();
  const exe = p === "win32" ? "llama-server.exe" : "llama-server";
  const local = findLlamaBin("llama-server");
  if (local) return local;
  if (p === "win32") {
    const cands = [
      resolve(process.env.LOCALAPPDATA || "", "Programs", "llama.cpp", exe),
      resolve(process.env.PROGRAMFILES || "", "llama.cpp", exe),
      resolve(home, "scoop", "apps", "llama.cpp", "current", exe),
    ];
    for (const c of cands) if (existsSync(c)) return c;
  }
  if (p === "darwin") {
    const cands = [
      "/opt/homebrew/bin/llama-server",
      "/usr/local/bin/llama-server",
      "/Applications/llama.cpp.app/Contents/MacOS/llama-server",
    ];
    for (const c of cands) if (existsSync(c)) return c;
  }
  if (p === "linux") {
    const cands = [
      "/usr/bin/llama-server",
      "/usr/local/bin/llama-server",
      resolve(home, ".local", "bin", "llama-server"),
    ];
    for (const c of cands) if (existsSync(c)) return c;
  }
  return null;
}