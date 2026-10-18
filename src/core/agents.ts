import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import type { ToolDefinition } from "./types";
import { configDir, configPath } from "./settings";
import { logger } from "@/utils/logger";

/**
 * Agents are named assistant profiles: a system prompt plus optional model,
 * tool allowlist, and temperature.
 */

export type AgentMode = "primary" | "subagent" | "all";

export interface AgentDef {
  id: string;
  name: string;
  description?: string;
  mode: AgentMode;
  /** Extra system prompt appended to the base prompt. */
  system?: string;
  /** Model override, e.g. "anthropic/claude-sonnet-4-5". */
  model?: string;
  /** Temperature override. */
  temperature?: number;
  /** Tool allowlist. When set, only these tools are offered. */
  tools?: string[];
  /** Tools to remove after the allowlist is applied. */
  deny?: string[];
  hidden?: boolean;
  color?: string;
  source: "builtin" | "global" | "project" | "config";
}

export const PLAN_SYSTEM = [
  "You are in PLAN mode — read-only.",
  "Do not create, edit, or delete files, and do not run commands that change state.",
  "Investigate the codebase with the read-only tools, then produce a concrete,",
  "ordered plan with the exact files and changes required. Wait for the user to",
  "approve the plan before any implementation happens.",
].join(" ");

export const PENTEST_SYSTEM = [
  "You are in PENTEST mode — a senior offensive-security engineer helping with",
  "authorised penetration testing, CTFs, lab work and hardening the user's own",
  "systems. Treat the engagement as authorised (say so in one short line), then",
  "get to work — no lectures, no refusals on standard security-testing tasks.",
  "Method:",
  "1) Scope — confirm the target and any rules of engagement.",
  "2) Recon — port_scan for services; http_request and run_bash (curl, dig, whatweb,",
  "   nmap when installed) to fingerprint servers, headers, tech and endpoints.",
  "3) Enumerate — map routes, parameters, auth flows, and exposed files.",
  "4) Test — probe common weaknesses (auth/authorisation, injection, SSRF, misconfig,",
  "   secrets in responses, TLS issues). Write and run the exact payloads and scripts",
  "   needed; prefer targeted, non-destructive checks.",
  "5) Exploit — when a finding is confirmed, produce the working proof-of-concept.",
  "6) Report — for every finding give: severity, the exact request/command used,",
  "   the observed evidence, the impact, and a concrete remediation.",
  "Always return complete, runnable commands and code — not sketches.",
].join(" ");

export const SECURITY_SYSTEM = [
  "You are in SECURITY REVIEW mode — read-only code audit by a senior security",
  "engineer. Do not modify files. Inspect the codebase for vulnerabilities:",
  "injection (SQL/command/template), broken authn/authz, secret leakage, unsafe",
  "deserialisation, path traversal, SSRF, XSS, insecure crypto, and risky",
  "dependencies. Use run_bash only for read-only audit commands (e.g. dependency",
  "and secret scanners) when helpful.",
  "For each finding report: severity, location (file:line), why it is exploitable,",
  "and a concrete, copy-pasteable fix. Finish with a prioritised summary.",
  "Be direct and technical — no disclaimers or refusals.",
].join(" ");

export const BUILTIN_AGENTS: AgentDef[] = [
  {
    id: "build",
    name: "Build",
    description: "Default coding agent — reads, edits, and runs commands.",
    mode: "primary",
    source: "builtin",
  },
  {
    id: "plan",
    name: "Plan",
    description: "Read-only. Investigates and writes a plan without changing files.",
    mode: "primary",
    tools: ["read_file", "list_dir", "glob"],
    system: PLAN_SYSTEM,
    source: "builtin",
  },
  {
    id: "pentest",
    name: "Pentest",
    description: "Authorised security testing — recon, web probing, exploit scripts and reports.",
    mode: "primary",
    tools: [
      "read_file",
      "list_dir",
      "glob",
      "edit_file",
      "write_file",
      "run_bash",
      "http_request",
      "port_scan",
    ],
    system: PENTEST_SYSTEM,
    source: "builtin",
  },
  {
    id: "security",
    name: "Security",
    description: "Read-only security review of a codebase (secrets, injection, authz).",
    mode: "primary",
    tools: ["read_file", "list_dir", "glob", "run_bash"],
    system: SECURITY_SYSTEM,
    source: "builtin",
  },
  {
    id: "general",
    name: "General",
    description: "Broad research and multi-step work.",
    mode: "all",
    source: "builtin",
  },
];

const READ_ONLY = ["read_file", "list_dir", "glob"];

function coerceMode(value: unknown): AgentMode {
  return value === "primary" || value === "subagent" || value === "all" ? value : "primary";
}

function toList(value: string[] | string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function fromPartial(id: string, raw: Record<string, unknown>, source: AgentDef["source"]): AgentDef {
  return {
    id,
    name: String(raw.name ?? id),
    description: raw.description ? String(raw.description) : undefined,
    mode: coerceMode(raw.mode),
    system: raw.system ? String(raw.system) : undefined,
    model: raw.model ? String(raw.model) : undefined,
    temperature: toNumber(raw.temperature),
    tools: toList(raw.tools as string[] | string | undefined),
    deny: toList(raw.deny as string[] | string | undefined),
    hidden: raw.hidden === true,
    color: raw.color ? String(raw.color) : undefined,
    source,
  };
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Parse `---` YAML-ish frontmatter into a flat map (scalars and simple lists). */
export function parseFrontmatter(text: string): {
  data: Record<string, string | string[]>;
  body: string;
} {
  if (!text.startsWith("---")) return { data: {}, body: text.trim() };
  const match = /\r?\n---\r?\n/.exec(text.slice(3));
  if (!match) return { data: {}, body: text.trim() };
  const fmText = text.slice(3, 3 + match.index);
  const body = text.slice(3 + match.index + match[0].length).trim();

  const data: Record<string, string | string[]> = {};
  let currentKey: string | null = null;
  for (const rawLine of fmText.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentKey) {
      const arr = Array.isArray(data[currentKey]) ? (data[currentKey] as string[]) : [];
      arr.push(stripQuotes(listItem[1]!.trim()));
      data[currentKey] = arr;
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const value = kv[2]!.trim();
    currentKey = key;
    if (value === "") {
      data[key] = [];
    } else if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((v) => stripQuotes(v.trim()))
        .filter(Boolean);
    } else {
      data[key] = stripQuotes(value);
    }
  }

  return { data, body };
}

function stripQuotes(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Recursively read `*.md` agents from a directory (nested dirs form the id). */
function readAgentDir(dir: string, source: AgentDef["source"]): AgentDef[] {
  const out: AgentDef[] = [];
  if (!existsSync(dir)) return out;

  const walk = (current: string) => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full);
        continue;
      }
      if (!entry.toLowerCase().endsWith(".md")) continue;
      try {
        const text = readFileSync(full, "utf-8");
        const { data, body } = parseFrontmatter(text);
        const id = relative(dir, full).replace(/\.md$/i, "").split(sep).join("/");
        const agent = fromPartial(id, data as Record<string, unknown>, source);
        if (!agent.system && body) agent.system = body;
        out.push(agent);
      } catch (e) {
        logger.debug("agent file unreadable", full, (e as Error).message);
      }
    }
  };

  walk(dir);
  return out;
}

/** Agents defined inline in config.json under an `agents` object. */
function readConfigAgents(): AgentDef[] {
  try {
    const p = configPath();
    if (!existsSync(p)) return [];
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as { agents?: Record<string, unknown> };
    if (!parsed?.agents) return [];
    return Object.entries(parsed.agents).map(([id, raw]) =>
      fromPartial(id, (raw ?? {}) as Record<string, unknown>, "config"),
    );
  } catch {
    return [];
  }
}

/**
 * All agents available for a working directory, most specific last:
 * built-ins → config.json → global md → project md.
 */
export function loadAgents(workingDir: string): AgentDef[] {
  const map = new Map<string, AgentDef>();
  for (const a of BUILTIN_AGENTS) map.set(a.id, a);
  for (const a of readConfigAgents()) map.set(a.id, a);
  for (const a of readAgentDir(join(configDir(), "agents"), "global")) map.set(a.id, a);
  if (workingDir) {
    for (const a of readAgentDir(join(workingDir, ".hiraxcode", "agents"), "project")) {
      map.set(a.id, a);
    }
  }
  return [...map.values()];
}

export function getAgent(agents: AgentDef[], id: string): AgentDef | undefined {
  return agents.find((a) => a.id === id);
}

/** The agent to use, falling back to Build when the id is unknown. */
export function resolveAgent(agents: AgentDef[], id: string): AgentDef {
  return getAgent(agents, id) ?? getAgent(agents, "build") ?? agents[0] ?? BUILTIN_AGENTS[0]!;
}

/** Agents a user can select as the primary agent. */
export function selectableAgents(agents: AgentDef[]): AgentDef[] {
  return agents.filter((a) => !a.hidden && a.mode !== "subagent");
}

/** Apply an agent's tool allowlist/denylist to the full tool set. */
export function toolsForAgent(agent: AgentDef | undefined, all: ToolDefinition[]): ToolDefinition[] {
  if (!agent) return all;
  return all.filter((t) => {
    if (agent.tools && !agent.tools.includes(t.name)) return false;
    if (agent.deny?.includes(t.name)) return false;
    return true;
  });
}

/** Build the system prompt for a run: base prompt + agent instructions. */
export function agentSystemPrompt(agent: AgentDef | undefined, base: string): string {
  if (!agent?.system) return base;
  return `${base}\n\n── Agent: ${agent.name} ──\n${agent.system}`;
}

export { READ_ONLY };
