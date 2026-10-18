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

/**
 * Resolve a user-supplied path against the working directory. Paths may point outside
 * the working directory on purpose (a monorepo sibling, a config in $HOME), so this does
 * not confine them; the approval prompt is the control for writes.
 */
function resolveInCwd(p: string, cwd: string): string {
  return resolve(cwd, p);
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

    const [out, err] = await Promise.all([
      readStreamCapped(proc.stdout, MAX_COMMAND_OUTPUT),
      readStreamCapped(proc.stderr, MAX_COMMAND_OUTPUT),
    ]);
    const code = await proc.exited;
    clearTimeout(timer);

    const stdout = out.text;
    const stderr = err.text;

    if (timedOut) {
      return {
        success: false,
        output: stdout.trim() || undefined,
        error: `Command timed out after ${timeoutMs}ms`,
      };
    }

    const combined = [stdout, stderr]
      .filter((s) => s.trim())
      .join("\n")
      .trim()
      .concat(out.truncated || err.truncated ? `\n… [output truncated at ${MAX_COMMAND_OUTPUT} bytes]` : "");

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
    const buf = await readCapped(res.body, args.maxBytes ?? 20_000, controller);
    const text = new TextDecoder().decode(buf.bytes);
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
        ? text + (buf.truncated ? "\n… [response truncated]" : "")
        : "(empty body)",
    );
    parts.push(
      "",
      `(${method} ${args.url} · ${elapsed}ms · ${buf.truncated ? ">=" : ""}${buf.total} bytes)`,
    );
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

/** Cap on how much command output is kept (and therefore sent to the model). */
const MAX_COMMAND_OUTPUT = 256 * 1024;

/**
 * Read a stream to text, keeping at most `max` characters. The rest is drained and
 * discarded so a chatty child process never blocks on a full pipe.
 */
async function readStreamCapped(
  stream: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!stream) return { text: "", truncated: false };
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (text.length >= max) {
        truncated = true;
        continue;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { text, truncated };
}

/**
 * Read at most `max` bytes of a response body, then abort the transfer. Unlike reading
 * the whole body and slicing afterwards, this keeps memory flat for huge responses.
 */
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  max: number,
  controller: AbortController,
): Promise<{ bytes: Uint8Array; total: number; truncated: boolean }> {
  if (!body) return { bytes: new Uint8Array(0), total: 0, truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let kept = 0;
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (kept < max) {
        const room = max - kept;
        chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
        kept += Math.min(value.byteLength, room);
      }
      if (total >= max) {
        truncated = true;
        controller.abort(); // stop pulling the rest of the body over the network
        break;
      }
    }
  } catch {
    // Aborting the transfer reports here; whatever we already read is still usable.
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(kept);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, total, truncated };
}

/* ------------------------------------------------------------------ *
 * CVE lookup (NIST NVD)
 * ------------------------------------------------------------------ */

export interface CveSummary {
  id: string;
  severity: string;
  score?: number;
  vector?: string;
  published?: string;
  summary: string;
  references: string[];
  /** The CPE version range that made this CVE relevant to the requested version. */
  match?: string;
}

const NVD_ENDPOINT = "https://services.nvd.nist.gov/rest/json/cves/2.0";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Pick the best available CVSS block: v3.1 first, then v3.0, then v2. */
function readCvss(metrics: Record<string, unknown> | undefined): {
  severity: string;
  score?: number;
  vector?: string;
} {
  if (!metrics) return { severity: "UNKNOWN" };
  for (const key of ["cvssMetricV31", "cvssMetricV30", "cvssMetricV2"]) {
    const entry = asRecord(asArray(metrics[key])[0]);
    if (!entry) continue;
    const data = asRecord(entry.cvssData);
    const score = typeof data?.baseScore === "number" ? data.baseScore : undefined;
    const raw =
      typeof data?.baseSeverity === "string" ? data.baseSeverity : entry.baseSeverity;
    return {
      severity: typeof raw === "string" ? raw.toUpperCase() : "UNKNOWN",
      score,
      vector: typeof data?.vectorString === "string" ? data.vectorString : undefined,
    };
  }
  return { severity: "UNKNOWN" };
}

function cveToSummary(cve: Record<string, unknown>): CveSummary {
  const description = asArray(cve.descriptions)
    .map(asRecord)
    .find((d) => d?.lang === "en");
  const cvss = readCvss(asRecord(cve.metrics));
  return {
    id: String(cve.id),
    severity: cvss.severity,
    score: cvss.score,
    vector: cvss.vector,
    published: typeof cve.published === "string" ? cve.published.slice(0, 10) : undefined,
    summary: clip(
      String(description?.value ?? "(no English description)").replace(/\s+/g, " ").trim(),
      400,
    ),
    references: asArray(cve.references)
      .map((r) => asRecord(r)?.url)
      .filter((u): u is string => typeof u === "string")
      .slice(0, 3),
  };
}

/** NVD CPE product names are lower-case with underscores: "apache_http_server". */
function slugProduct(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** `cpe:2.3:a:nginx:nginx:1.24.0:*:*:*:*:*:*:*` → its meaningful fields. */
export function splitCpe(criteria: string): {
  part?: string;
  vendor?: string;
  product?: string;
  version?: string;
} {
  const parts = criteria.split(":");
  if (parts.length < 6 || parts[0] !== "cpe") return {};
  return { part: parts[2], vendor: parts[3], product: parts[4], version: parts[5] };
}

function versionTokens(v: string): (number | string)[] {
  return (v.match(/\d+|[a-z]+/gi) ?? []).map((t) =>
    /^\d+$/.test(t) ? Number(t) : t.toLowerCase(),
  );
}

/** Compare two version strings the way CPE ranges need: numeric parts as numbers. */
export function compareVersions(a: string, b: string): number {
  const ta = versionTokens(a);
  const tb = versionTokens(b);
  const n = Math.max(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const x = ta[i] ?? 0;
    const y = tb[i] ?? 0;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
      continue;
    }
    const sx = String(x);
    const sy = String(y);
    if (sx !== sy) return sx < sy ? -1 : 1;
  }
  return 0;
}

/**
 * Does one NVD cpeMatch entry describe the product we asked about, at the version we
 * asked about? Returns a short human description of the matching range, or undefined.
 */
export function cpeMatchApplies(
  match: Record<string, unknown>,
  filter: { product: string; vendor?: string; version?: string },
): string | undefined {
  if (match.vulnerable === false) return undefined;
  const cpe = splitCpe(typeof match.criteria === "string" ? match.criteria : "");
  if (!cpe.product) return undefined;
  if (cpe.part && cpe.part !== "a" && cpe.part !== "o" && cpe.part !== "h") return undefined;

  const wanted = slugProduct(filter.product);
  const actual = cpe.product.toLowerCase();
  if (actual !== wanted && !actual.includes(wanted) && !wanted.includes(actual)) {
    return undefined;
  }
  if (filter.vendor && cpe.vendor && cpe.vendor !== slugProduct(filter.vendor)) {
    return undefined;
  }

  const version = filter.version;
  if (!version) return describeCpeRange(match, cpe.version);

  const starts = [
    ["versionStartIncluding", (x: number) => x >= 0, ">="],
    ["versionStartExcluding", (x: number) => x > 0, ">"],
  ] as const;
  const ends = [
    ["versionEndIncluding", (x: number) => x <= 0, "<="],
    ["versionEndExcluding", (x: number) => x < 0, "<"],
  ] as const;

  let bounded = false;
  for (const [key, ok] of [...starts, ...ends]) {
    const bound = match[key];
    if (typeof bound !== "string") continue;
    bounded = true;
    if (!ok(compareVersions(version, bound))) return undefined;
  }
  if (bounded) return describeCpeRange(match, cpe.version);

  if (cpe.version && cpe.version !== "*" && cpe.version !== "-") {
    return compareVersions(version, cpe.version) === 0 ? `=${cpe.version}` : undefined;
  }
  // An "any version" CPE: the product matches, the version is not constrained.
  return cpe.version === "*" ? "any version" : undefined;
}

function describeCpeRange(
  match: Record<string, unknown>,
  cpeVersion: string | undefined,
): string {
  const bits: string[] = [];
  const add = (key: string, prefix: string) => {
    const v = match[key];
    if (typeof v === "string") bits.push(`${prefix}${v}`);
  };
  add("versionStartIncluding", ">=");
  add("versionStartExcluding", ">");
  add("versionEndIncluding", "<=");
  add("versionEndExcluding", "<");
  if (bits.length > 0) return bits.join(" ");
  if (cpeVersion && cpeVersion !== "*" && cpeVersion !== "-") return `=${cpeVersion}`;
  return "any version";
}

/** Every CPE version range in a CVE that covers the requested product/version. */
function collectAffects(
  entry: Record<string, unknown> | undefined,
  cve: Record<string, unknown>,
  filter: { product: string; vendor?: string; version?: string },
): string[] {
  const found = new Set<string>();
  const configs = [...asArray(cve.configurations), ...asArray(entry?.configurations)];
  for (const config of configs) {
    for (const node of asArray(asRecord(config)?.nodes)) {
      for (const raw of asArray(asRecord(node)?.cpeMatch)) {
        const match = asRecord(raw);
        if (!match) continue;
        const described = cpeMatchApplies(match, filter);
        if (described) found.add(described);
      }
    }
  }
  return [...found];
}

/**
 * Filter an NVD response down to the CVEs that actually affect a product/version, using
 * the CPE version ranges NVD publishes. Pure, so it is testable offline.
 */
export function selectCves(
  payload: unknown,
  filter: { product?: string; vendor?: string; version?: string },
  limit: number,
): CveSummary[] {
  const root = asRecord(payload);
  const rows: CveSummary[] = [];
  const filtering = Boolean(filter.product && (filter.version || filter.vendor));

  for (const item of asArray(root?.vulnerabilities)) {
    const entry = asRecord(item);
    const cve = asRecord(entry?.cve);
    if (typeof cve?.id !== "string") continue;
    if (cve.vulnStatus === "Rejected") continue;

    if (filtering && filter.product) {
      const affects = collectAffects(entry, cve, {
        product: filter.product,
        vendor: filter.vendor,
        version: filter.version,
      });
      if (affects.length === 0) continue;
      rows.push({ ...cveToSummary(cve), match: affects.slice(0, 2).join(" / ") });
    } else {
      rows.push(cveToSummary(cve));
    }
    if (rows.length >= limit) break;
  }
  return rows;
}

/** Parse an NVD 2.0 response into a compact, model-friendly list. Pure, so it is testable. */
export function parseNvdCves(payload: unknown, limit: number): CveSummary[] {
  return selectCves(payload, {}, limit);
}

/** Render CVEs for the model: one block per finding, worst information first. */
export function formatCves(rows: CveSummary[], header: string): string {
  if (rows.length === 0) return `${header}\n(no CVEs found)`;
  const parts: string[] = [header];
  for (const r of rows) {
    const score = r.score !== undefined ? `${r.score} ${r.severity}` : r.severity;
    parts.push("", `${r.id}  [${score}]${r.published ? `  ${r.published}` : ""}`);
    if (r.vector) parts.push(`  vector: ${r.vector}`);
    if (r.match) parts.push(`  affects: ${r.match}`);
    parts.push(`  ${r.summary}`);
    if (r.references.length > 0) parts.push(`  refs: ${r.references.join(" · ")}`);
  }
  return parts.join("\n");
}

export const cveLookupTool: ToolDefinition = {
  name: "cve_lookup",
  description:
    "Look up published CVEs for a product and optional version via the NIST NVD. Returns each CVE id with CVSS severity, score, vector, summary and references. Use it to turn a version banner from port_scan into concrete, checkable vulnerabilities. Read-only public API query.",
  needsApproval: false,
  safe: true,
  parameters: z.object({
    product: z
      .string()
      .describe('Product or technology name, e.g. "nginx", "apache http server", "wordpress"'),
    version: z.string().optional().describe('Version seen on the target, e.g. "1.24.0"'),
    vendor: z.string().optional().describe("Vendor, when known — makes the match precise"),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum CVEs to return (default 10, max 50)"),
    timeout: z.number().int().min(1000).optional().describe("Timeout in ms (default 20000)"),
  }),
};

export async function cveLookup(
  args: {
    product: string;
    version?: string;
    vendor?: string;
    limit?: number;
    timeout?: number;
  },
  _cwd: string,
): Promise<ToolResultPayload> {
  const product = args.product.trim();
  if (!product) return { success: false, error: "product is required" };

  const limit = Math.max(1, Math.min(args.limit ?? 10, 50));
  const timeoutMs = args.timeout ?? 20_000;
  const version = args.version?.trim() || undefined;
  const vendor = args.vendor?.trim() || undefined;
  const label = [product, version].filter(Boolean).join(" ");

  const search = async (
    params: URLSearchParams,
  ): Promise<{ payload?: unknown; error?: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      const key = process.env.NVD_API_KEY?.trim();
      if (key) headers.apiKey = key;
      const res = await fetch(`${NVD_ENDPOINT}?${params.toString()}`, {
        headers,
        signal: controller.signal,
      });
      if (res.status === 403 || res.status === 429) {
        return {
          error:
            "NVD rate limit reached (roughly 5 requests per 30s without an API key). Wait 30 seconds and retry, or set NVD_API_KEY.",
        };
      }
      if (!res.ok) return { error: `NVD returned HTTP ${res.status} ${res.statusText}` };
      return { payload: await res.json() };
    } catch (e) {
      const err = e as Error;
      return {
        error: err.name === "AbortError" ? `NVD request timed out after ${timeoutMs}ms` : err.message,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const PAGE = 2000; // NVD's maximum page size: fetch once, filter and sort locally.
  const queries: { params: URLSearchParams; exact: boolean }[] = [];
  const base = new URLSearchParams({ resultsPerPage: String(PAGE) });

  // An exact CPE name is the most precise query: NVD resolves the version ranges itself.
  if (vendor && version) {
    const exact = new URLSearchParams(base);
    exact.set(
      "cpeName",
      `cpe:2.3:a:${slugProduct(vendor)}:${slugProduct(product)}:${version}:*:*:*:*:*:*:*`,
    );
    queries.push({ params: exact, exact: true });
  }
  const keyword = new URLSearchParams(base);
  keyword.set("keywordSearch", product);
  queries.push({ params: keyword, exact: false });

  for (const query of queries) {
    const out = await search(query.params);
    if (out.error) return { success: false, error: out.error };

    // The exact query is already version-filtered by NVD; the keyword query needs our
    // own CPE version-range filter to remove CVEs that do not affect this release.
    const rows = query.exact
      ? parseNvdCves(out.payload, PAGE)
      : selectCves(out.payload, { product, vendor, version }, PAGE);
    if (rows.length === 0) continue;

    // Highest CVSS first, then newest: that is the triage order an operator wants.
    rows.sort(
      (a, b) =>
        (b.score ?? -1) - (a.score ?? -1) || (b.published ?? "").localeCompare(a.published ?? ""),
    );
    const top = rows.slice(0, limit);
    const how = version ? `affecting ${version}` : "for this product";
    return {
      success: true,
      output: formatCves(top, `NVD · ${label} · ${top.length} CVE(s) ${how}, highest CVSS first`),
    };
  }
  return { success: true, output: formatCves([], `NVD · ${label} · no CVEs found`) };
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
  cveLookupTool,
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
    case "cve_lookup":
      return cveLookup(args as never, cwd);
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}
