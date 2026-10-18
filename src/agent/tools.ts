import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join, relative, resolve } from "path";
import { platform } from "os";
import { connect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { lookup } from "node:dns/promises";
import { globIterate } from "glob";
import { z } from "zod";
import type { ToolDefinition, ToolResultPayload } from "@/core/types";
import { logger } from "@/utils/logger";
import { spawn, which } from "@/utils/runtime";

/** Resolve a user-supplied path against the working directory. */
function resolveInCwd(p: string, cwd: string): string {
  return resolve(cwd, p);
}

/** Guard against escaping the working directory. */
export function isInsideCwd(p: string, cwd: string): boolean {
  const abs = resolveInCwd(p, cwd);
  const rel = relative(cwd, abs);
  return rel === "" || (!rel.startsWith("..") && !resolve(rel).startsWith("/.."));
}

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description:
    "Read the full contents of a text file. Use this before editing a file so you have exact text to match.",
  needsApproval: false,
  safe: true,
  parameters: z.object({
    path: z.string().describe("File path, relative to the working directory"),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("First line to read (1-based, optional)"),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum number of lines to read (optional)"),
  }),
};

export async function readFile(
  args: { path: string; offset?: number; limit?: number },
  cwd: string,
): Promise<ToolResultPayload> {
  try {
    const abs = resolveInCwd(args.path, cwd);
    if (!existsSync(abs)) return { success: false, error: `File not found: ${args.path}` };
    if (statSync(abs).isDirectory())
      return { success: false, error: `Not a file: ${args.path}` };

    const raw = readFileSync(abs, "utf-8");
    const lines = raw.split("\n");

    if (args.offset == null && args.limit == null) {
      return { success: true, output: raw };
    }

    const start = Math.max(0, (args.offset ?? 1) - 1);
    const end = args.limit != null ? start + args.limit : lines.length;
    const slice = lines.slice(start, end);

    const numbered = slice
      .map((l, i) => `${String(start + i + 1).padStart(4)}: ${l}`)
      .join("\n");

    return { success: true, output: numbered };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export const listDirTool: ToolDefinition = {
  name: "list_dir",
  description: "List files and folders in a directory.",
  needsApproval: false,
  safe: true,
  parameters: z.object({
    path: z
      .string()
      .optional()
      .describe("Directory path relative to the working directory (default: .)"),
  }),
};

export async function listDir(
  args: { path?: string },
  cwd: string,
): Promise<ToolResultPayload> {
  try {
    const target = args.path || ".";
    const abs = resolveInCwd(target, cwd);
    if (!existsSync(abs)) return { success: false, error: `Not found: ${target}` };

    const entries = readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.name !== "node_modules" && e.name !== ".git")
      .map((e) => `${e.isDirectory() ? "[dir] " : "      "}${e.name}`)
      .sort();

    return { success: true, output: entries.join("\n") || "(empty)" };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export const globTool: ToolDefinition = {
  name: "glob",
  description:
    "Find files by glob pattern, e.g. '**/*.ts' or 'src/**/*.tsx'. Returns matching paths.",
  needsApproval: false,
  safe: true,
  parameters: z.object({
    pattern: z.string().describe("Glob pattern"),
    limit: z.number().int().min(1).optional().describe("Max results (default 200)"),
  }),
};

export async function globFiles(
  args: { pattern: string; limit?: number },
  cwd: string,
): Promise<ToolResultPayload> {
  try {
    const limit = args.limit ?? 200;
    const results: string[] = [];
    // `glob` yields platform-native separators on Windows; normalise to POSIX
    // so the output matches what the model expects (and the filters below work).
    for await (const match of globIterate(args.pattern, { cwd, dot: false })) {
      const file = match.split("\\").join("/");
      if (file.startsWith("node_modules/") || file.startsWith(".git/")) continue;
      results.push(file);
      if (results.length >= limit) break;
    }
    results.sort();
    return {
      success: true,
      output: results.length ? results.join("\n") : "(no matches)",
    };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description:
    "Create a new file or completely overwrite an existing one. For small changes prefer edit_file.",
  needsApproval: true,
  safe: false,
  parameters: z.object({
    path: z.string().describe("File path relative to the working directory"),
    content: z.string().describe("Full content to write"),
  }),
};

export async function writeFile(
  args: { path: string; content: string },
  cwd: string,
): Promise<ToolResultPayload> {
  try {
    const abs = resolveInCwd(args.path, cwd);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, args.content, "utf-8");
    return { success: true, output: `Wrote ${relative(cwd, abs) || args.path}` };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description:
    "Replace an exact snippet of text in a file. oldString must match exactly once unless replaceAll is true. Include surrounding lines to make it unique.",
  needsApproval: true,
  safe: false,
  parameters: z.object({
    path: z.string().describe("File path relative to the working directory"),
    oldString: z.string().describe("Exact existing text to find"),
    newString: z.string().describe("Replacement text"),
    replaceAll: z.boolean().optional().describe("Replace every occurrence"),
  }),
};

export async function editFile(
  args: {
    path: string;
    oldString: string;
    newString: string;
    replaceAll?: boolean;
  },
  cwd: string,
): Promise<ToolResultPayload> {
  try {
    const abs = resolveInCwd(args.path, cwd);
    if (!existsSync(abs)) return { success: false, error: `File not found: ${args.path}` };

    const content = readFileSync(abs, "utf-8");

    if (args.oldString === args.newString) {
      return { success: false, error: "oldString and newString are identical" };
    }

    const count = content.split(args.oldString).length - 1;

    if (count === 0) {
      return {
        success: false,
        error: "oldString not found. Read the file again and copy the exact text.",
      };
    }

    if (args.replaceAll) {
      writeFileSync(abs, content.replaceAll(args.oldString, args.newString), "utf-8");
      return { success: true, output: `Replaced ${count} occurrence(s) in ${args.path}` };
    }

    if (count > 1) {
      return {
        success: false,
        error: `oldString matched ${count} times. Add more context or set replaceAll=true.`,
      };
    }

    writeFileSync(abs, content.replace(args.oldString, args.newString), "utf-8");
    return { success: true, output: `Edited ${args.path}` };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export const runBashTool: ToolDefinition = {
  name: "run_bash",
  description:
    "Run a shell command in the working directory and return its stdout/stderr. Uses bash/zsh on macOS and Linux, and PowerShell on Windows. Use for builds, tests, git and quick inspection.",
  needsApproval: true,
  safe: false,
  parameters: z.object({
    command: z.string().describe("Shell command to execute"),
    timeout: z
      .number()
      .int()
      .min(1000)
      .optional()
      .describe("Timeout in milliseconds (default 120000)"),
  }),
};

/** Pick an argv prefix that runs `command` in the platform's shell. */
export function shellArgv(command: string): string[] {
  if (platform() === "win32") {
    // Windows PowerShell is present on every supported Windows version.
    const ps = which("pwsh") ?? which("powershell");
    if (ps) return [ps, "-NoProfile", "-NonInteractive", "-Command", command];
    return [process.env.ComSpec || "cmd.exe", "/d", "/s", "/c", command];
  }
  const sh =
    process.env.SHELL && which(process.env.SHELL)
      ? process.env.SHELL
      : which("bash") ?? which("zsh") ?? "/bin/sh";
  return [sh, "-lc", command];
}

export async function runBash(
  args: { command: string; timeout?: number },
  cwd: string,
): Promise<ToolResultPayload> {
  try {
    logger.debug("run_bash:", args.command);
    const proc = spawn(shellArgv(args.command), {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutMs = args.timeout ?? 120_000;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    clearTimeout(timer);

    if (timedOut) {
      return {
        success: false,
        output: stdout.trim() || undefined,
        error: `Command timed out after ${timeoutMs}ms`,
      };
    }

    const combined = [stdout, stderr].filter((s) => s.trim()).join("\n").trim();

    if (code === 0) {
      return { success: true, output: combined || "(no output)" };
    }
    return {
      success: false,
      output: stdout.trim() || undefined,
      error: `Exit code ${code}${stderr.trim() ? `\n${stderr.trim()}` : ""}`,
    };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// ── security / pentest tools ────────────────────────────────────────────────

export const httpRequestTool: ToolDefinition = {
  name: "http_request",
  description:
    "Send an HTTP/HTTPS request and return the status line, response headers and a (truncated) body. Use it to probe web endpoints, methods, headers and payloads during authorised security testing. Only target systems you own or have explicit permission to test.",
  needsApproval: false,
  safe: true,
  parameters: z.object({
    url: z.string().describe("Absolute http:// or https:// URL"),
    method: z
      .enum(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"])
      .optional()
      .describe("HTTP method (default GET)"),
    headers: z
      .record(z.string())
      .optional()
      .describe("Request headers, e.g. { \"Authorization\": \"Bearer …\" }"),
    body: z.string().optional().describe("Request body (for POST/PUT/PATCH/DELETE)"),
    timeout: z.number().int().min(500).optional().describe("Timeout in ms (default 15000)"),
    maxBytes: z
      .number()
      .int()
      .min(256)
      .optional()
      .describe("Maximum response bytes to display (default 20000)"),
    followRedirects: z
      .boolean()
      .optional()
      .describe("Follow redirects (default false, so you can inspect the 3xx)"),
  }),
};

const NO_BODY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function httpRequest(
  args: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    maxBytes?: number;
    followRedirects?: boolean;
  },
  _cwd: string,
): Promise<ToolResultPayload> {
  if (!/^https?:\/\//i.test(args.url)) {
    return { success: false, error: "url must start with http:// or https://" };
  }
  const method = (args.method ?? "GET").toUpperCase();
  const controller = new AbortController();
  const timeoutMs = args.timeout ?? 15_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const started = Date.now();
    const res = await fetch(args.url, {
      method,
      headers: args.headers,
      body: NO_BODY_METHODS.has(method) ? undefined : args.body,
      redirect: args.followRedirects ? "follow" : "manual",
      signal: controller.signal,
    });
    const buf = await res.arrayBuffer();
    const maxBytes = args.maxBytes ?? 20_000;
    const slice = buf.slice(0, maxBytes);
    const text = new TextDecoder().decode(slice);
    const truncated = buf.byteLength > maxBytes;
    const elapsed = Date.now() - started;

    const headerLines = [...res.headers.entries()]
      .map(([k, v]) => `${k}: ${clip(v, 400)}`)
      .join("\n");

    const parts: string[] = [`HTTP ${res.status} ${res.statusText}`.trim()];
    if (res.url && res.url !== args.url) parts.push(`final-url: ${res.url}`);
    if (headerLines) parts.push(headerLines);
    parts.push("");
    parts.push(
      text.length > 0
        ? text + (truncated ? `\n… [${buf.byteLength - maxBytes} more bytes]` : "")
        : "(empty body)",
    );
    parts.push("", `(${method} ${args.url} · ${elapsed}ms · ${buf.byteLength} bytes)`);
    return { success: true, output: parts.join("\n") };
  } catch (e) {
    const err = e as Error;
    const msg =
      err.name === "AbortError" ? `request timed out after ${timeoutMs}ms` : err.message;
    return { success: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** Common ports probed when the caller does not pass a list. */
const COMMON_PORTS = [
  21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 465, 587, 993, 995, 1433,
  1521, 2049, 2375, 3000, 3306, 3389, 5000, 5432, 5900, 6379, 8000, 8080, 8443, 8888,
  9000, 9200, 11211, 27017,
];

/** Parse "22,80,1000-1005" into a sorted, de-duplicated port list. */
export function parsePorts(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(/[,\s]+/)) {
    if (!part) continue;
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (a > b) [a, b] = [b, a];
      for (let p = a; p <= b; p++) if (p >= 1 && p <= 65535) out.add(p);
      continue;
    }
    const n = Number(part);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function probePort(host: string, port: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export const portScanTool: ToolDefinition = {
  name: "port_scan",
  description:
    "TCP-connect scan of a host with service fingerprinting (reconnaissance). Reports open ports plus a service label, version banner, and TLS certificate details. Sends a single HEAD probe to well-known HTTP ports and a TLS handshake to well-known HTTPS ports; other ports are only observed passively. Only scan systems you own or have explicit permission to test.",
  needsApproval: true,
  safe: false,
  parameters: z.object({
    host: z.string().describe("Hostname or IP address"),
    ports: z
      .string()
      .optional()
      .describe('Ports to test, e.g. "22,80,443" or "1-1024" (default: common ports)'),
    timeout: z
      .number()
      .int()
      .min(50)
      .optional()
      .describe("Per-port timeout in ms (default 500)"),
    concurrency: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Parallel connections (default 128)"),
    banner: z
      .boolean()
      .optional()
      .describe("Fingerprint services/versions and TLS (default true)"),
  }),
};

/** Ports that normally speak TLS, so we handshake instead of reading a plaintext banner. */
const TLS_PORTS = new Set([443, 465, 636, 990, 993, 995, 3269, 5986, 6443, 8443, 8834, 9443]);

/** Ports that normally speak plaintext HTTP and will answer a HEAD probe. */
const HTTP_PORTS = new Set([
  80, 3000, 5000, 5601, 7001, 8000, 8008, 8080, 8081, 8088, 8181, 8888, 8983, 9000, 9080,
  10000, 15672,
]);

const SCAN_UA = "HiraxCode/1.0";

function headProbe(host: string): string {
  return `HEAD / HTTP/1.0\r\nHost: ${host}\r\nUser-Agent: ${SCAN_UA}\r\nConnection: close\r\n\r\n`;
}

/** Fraction of characters that are printable ASCII — used to discard binary banners. */
function printableRatio(s: string): number {
  if (!s) return 0;
  let ok = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) ok++;
  }
  return ok / s.length;
}

/**
 * Read whatever a socket volunteers. Some services greet on connect (SSH, FTP, SMTP);
 * HTTP needs a poke, which is what `send` is for.
 */
function readBanner(
  host: string,
  port: number,
  timeout: number,
  send?: string,
  limit = 4096,
): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    const socket = connect({ host, port });
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve(data);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => {
      if (!send) return;
      try {
        socket.write(send);
      } catch {}
    });
    socket.on("data", (chunk: Buffer) => {
      data += chunk.toString("latin1");
      if (data.length >= limit) finish();
    });
    socket.once("timeout", finish);
    socket.once("error", finish);
    socket.once("close", finish);
  });
}

/** Complete a TLS handshake to summarise the certificate, then read the HTTP layer on top. */
function readTls(
  host: string,
  port: number,
  timeout: number,
  limit = 4096,
): Promise<{ raw: string; cert?: string }> {
  return new Promise((resolve) => {
    let raw = "";
    let cert: string | undefined;
    let settled = false;
    const socket = tlsConnect({ host, port, rejectUnauthorized: false, timeout });
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve({ raw, cert });
    };
    socket.once("secureConnect", () => {
      try {
        const c = socket.getPeerCertificate();
        const bits = [
          `CN=${c?.subject?.CN ?? "(no CN)"}`,
          `issuer=${c?.issuer?.O ?? c?.issuer?.CN ?? "(unknown)"}`,
        ];
        if (c?.valid_to) bits.push(`expires ${c.valid_to}`);
        const proto = socket.getProtocol();
        if (proto) bits.push(proto);
        cert = bits.join(" · ");
      } catch {}
      try {
        socket.write(headProbe(host));
      } catch {}
    });
    socket.on("data", (chunk: Buffer) => {
      raw += chunk.toString("latin1");
      if (raw.length >= limit) finish();
    });
    socket.once("timeout", finish);
    socket.once("error", finish);
    socket.once("close", finish);
  });
}

/** Pull the status code and Server header out of a raw HTTP/1.x response. */
export function readHttpMeta(raw: string): { status?: string; server?: string } {
  const [first = ""] = raw.split(/\r?\n/, 1);
  const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3}[^\r\n]*)/i.exec(first)?.[1]?.trim();
  const server = raw
    .split(/\r?\n/)
    .find((l) => /^server:/i.test(l))
    ?.slice(7)
    .trim();
  return { status, server };
}

/** Turn a raw banner into a service label and a one-line version/detail string. */
export function describeService(port: number, raw: string): Fingerprint {
  const text = raw.replace(/\0/g, "").trim();
  if (!text) return {};

  const ssh = /^SSH-([\d.]+)-(\S.*)$/m.exec(text);
  if (ssh) return { service: "ssh", detail: clip(ssh[2].trim(), 140) };

  const http = readHttpMeta(text);
  if (http.status) {
    return {
      service: TLS_PORTS.has(port) ? "https" : "http",
      detail: clip([http.server, http.status].filter(Boolean).join(" · "), 140),
    };
  }

  const greet = /^220[\s-]+(.+)$/m.exec(text);
  if (greet) return { detail: clip(greet[1].trim(), 140) };

  const first = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  if (!first || printableRatio(first) < 0.8) return {};
  return { detail: clip(first, 140) };
}

export interface Fingerprint {
  service?: string;
  detail?: string;
  cert?: string;
}

/**
 * Second pass over the open ports: identify the service, its version and (for TLS)
 * the certificate. Best-effort — a failed probe never fails the scan.
 */
async function fingerprintServices(
  host: string,
  ports: number[],
  timeout: number,
  concurrency: number,
): Promise<Map<number, Fingerprint>> {
  const out = new Map<number, Fingerprint>();
  const grabTimeout = Math.max(300, Math.min(timeout, 1200));
  let index = 0;

  const worker = async () => {
    while (index < ports.length) {
      const port = ports[index++]!;
      try {
        if (TLS_PORTS.has(port)) {
          const tls = await readTls(host, port, grabTimeout);
          const meta = readHttpMeta(tls.raw);
          out.set(port, {
            service: "https",
            detail: clip([meta.server, meta.status].filter(Boolean).join(" · "), 140) || undefined,
            cert: tls.cert,
          });
        } else if (HTTP_PORTS.has(port)) {
          const raw = await readBanner(host, port, grabTimeout, headProbe(host));
          out.set(port, describeService(port, raw));
        } else {
          // Most services greet on connect. If nothing arrives, the port is either a
          // silent protocol or HTTP on a non-standard port — one HEAD probe tells us.
          const passive = await readBanner(host, port, Math.min(grabTimeout, 500));
          const raw = passive || (await readBanner(host, port, grabTimeout, headProbe(host)));
          out.set(port, describeService(port, raw));
        }
      } catch {
        // fingerprinting is optional context
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ports.length) }, worker));
  return out;
}

export async function portScan(
  args: {
    host: string;
    ports?: string;
    timeout?: number;
    concurrency?: number;
    banner?: boolean;
  },
  _cwd: string,
): Promise<ToolResultPayload> {
  const host = args.host.trim();
  if (!host) return { success: false, error: "host is required" };

  const ports = args.ports ? parsePorts(args.ports) : [...COMMON_PORTS];
  if (ports.length === 0) return { success: false, error: `no valid ports in "${args.ports}"` };
  if (ports.length > 20_000) {
    return { success: false, error: `too many ports (${ports.length}); refine the range` };
  }

  try {
    await lookup(host);
  } catch {
    return { success: false, error: `cannot resolve host: ${host}` };
  }

  const timeout = args.timeout ?? 500;
  const concurrency = Math.max(1, Math.min(args.concurrency ?? 128, 512));
  const open: number[] = [];
  let index = 0;

  const worker = async () => {
    while (index < ports.length) {
      const port = ports[index++]!;
      if (await probePort(host, port, timeout)) open.push(port);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ports.length) }, worker));

  open.sort((a, b) => a - b);
  const head = `${host}: ${open.length} open / ${ports.length} scanned`;
  if (open.length === 0) {
    return { success: true, output: `${head}\n(no open ports found)` };
  }

  const info =
    args.banner === false ? new Map<number, Fingerprint>() : await fingerprintServices(host, open, timeout, concurrency);

  const lines: string[] = [];
  for (const p of open) {
    const fp = info.get(p);
    const service = fp?.service ?? PORT_NAMES[p] ?? (TLS_PORTS.has(p) ? "ssl" : "");
    const row = `open  ${String(p).padEnd(6)} ${service}`.trimEnd();
    lines.push(fp?.detail ? `${row}   ${fp.detail}` : row);
    if (fp?.cert) lines.push(`      └ tls: ${fp.cert}`);
  }
  return { success: true, output: [head, "", ...lines].join("\n") };
}

/** Small label table for the most common service ports. */
const PORT_NAMES: Record<number, string> = {
  21: "ftp",
  22: "ssh",
  23: "telnet",
  25: "smtp",
  53: "dns",
  80: "http",
  110: "pop3",
  111: "rpcbind",
  135: "msrpc",
  139: "netbios-ssn",
  143: "imap",
  443: "https",
  445: "microsoft-ds",
  465: "smtps",
  587: "submission",
  993: "imaps",
  995: "pop3s",
  1433: "mssql",
  1521: "oracle",
  2049: "nfs",
  2375: "docker",
  3000: "http-alt",
  3306: "mysql",
  3389: "rdp",
  5000: "http-alt",
  5432: "postgresql",
  5900: "vnc",
  6379: "redis",
  8000: "http-alt",
  8080: "http-proxy",
  8443: "https-alt",
  8888: "http-alt",
  9000: "http-alt",
  9200: "elasticsearch",
  11211: "memcached",
  27017: "mongodb",
};

export const allTools: ToolDefinition[] = [
  readFileTool,
  listDirTool,
  globTool,
  editFileTool,
  writeFileTool,
  runBashTool,
  httpRequestTool,
  portScanTool,
];

/** Execute a tool by name, dispatching to the right implementation. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
): Promise<ToolResultPayload> {
  switch (name) {
    case "read_file":
      return readFile(args as never, cwd);
    case "list_dir":
      return listDir(args as never, cwd);
    case "glob":
      return globFiles(args as never, cwd);
    case "write_file":
      return writeFile(args as never, cwd);
    case "edit_file":
      return editFile(args as never, cwd);
    case "run_bash":
      return runBash(args as never, cwd);
    case "http_request":
      return httpRequest(args as never, cwd);
    case "port_scan":
      return portScan(args as never, cwd);
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}
