import { existsSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "fs";
import { inflateRawSync } from "zlib";
import { homedir, platform, arch } from "os";
import { join } from "path";
import { logger } from "./logger";

function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "hiraxcode", "bin");
}

export interface BinarySpec {
  name: string;
  repo?: string;
  url: (os: string, arch: string) => string | null;
  /** executable file name inside the archive */
  binFile: (os: string, arch: string) => string;
}

export const LLAMA_SERVER_SPEC: BinarySpec = {
  name: "llama-server",
  repo: "ggml-org/llama.cpp",
  url: (os, a) => {
    if (os === "win32" && a === "x64")
      return "https://github.com/ggml-org/llama.cpp/releases/download/b6522/llama-b6522-bin-win-cpu-x64.zip";
    if (os === "win32" && a === "arm64")
      return "https://github.com/ggml-org/llama.cpp/releases/download/b6522/llama-b6522-bin-win-cpu-arm64.zip";
    if (os === "darwin" && a === "x64")
      return "https://github.com/ggml-org/llama.cpp/releases/download/b6522/llama-b6522-bin-macos-x64.zip";
    if (os === "darwin" && a === "arm64")
      return "https://github.com/ggml-org/llama.cpp/releases/download/b6522/llama-b6522-bin-macos-arm64.zip";
    if (os === "linux" && a === "x64")
      return "https://github.com/ggml-org/llama.cpp/releases/download/b6522/llama-b6522-bin-linux-x64.zip";
    if (os === "linux" && a === "arm64")
      return "https://github.com/ggml-org/llama.cpp/releases/download/b6522/llama-b6522-bin-linux-arm64.zip";
    return null;
  },
  binFile: (os) => (os === "win32" ? "llama-server.exe" : "llama-server"),
};

/** Minimal ZIP reader (stored + deflate), good enough for release archives. */
function readZip(data: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // End Of Central Directory: signature 0x06054b50, scan from the tail.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();

  for (let n = 0; n < total; n++) {
    if (p + 46 > data.length || dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(data.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // directory entry

    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = data.subarray(start, start + compSize);
    let content: Uint8Array;
    if (method === 0) content = raw.slice();
    else if (method === 8) content = new Uint8Array(inflateRawSync(raw));
    else throw new Error(`unsupported zip method ${method}`);
    out.set(name, content);
  }
  return out;
}

/**
 * Download a binary archive and unpack it into the local cache.
 * Returns the absolute path of the executable.
 */
export async function ensureBinary(spec: BinarySpec, force = false): Promise<string> {
  const os = platform();
  const a = arch();
  const url = spec.url(os, a);
  if (!url) throw new Error(`No prebuilt ${spec.name} for ${os}/${a}`);

  const dir = join(cacheDir(), spec.name);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, spec.binFile(os, a));
  if (!force && existsSync(dest)) return dest;

  logger.info("downloading", spec.name, url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const data = new Uint8Array(await res.arrayBuffer());

  const entries = readZip(data);
  if (entries.size === 0) throw new Error("zip contained no files");

  for (const [name, content] of entries) {
    const base = name.split("/").filter(Boolean).pop()!;
    if (!base || name.endsWith("/")) continue;
    const file = join(dir, base);
    writeFileSync(file, content);
    if (os !== "win32") {
      try {
        chmodSync(file, 0o755);
      } catch {}
    }
  }

  if (!existsSync(dest)) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`${spec.binFile(os, a)} not found in archive`);
  }
  logger.info("installed", spec.name, "→", dest);
  return dest;
}
