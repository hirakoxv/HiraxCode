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

export const BUILD_SYSTEM = [
  "You are in BUILD mode — the primary implementation agent. Operate as a staff-level",
  "engineer who has shipped safety-critical software: correctness is non-negotiable and",
  "every line you write must survive review by a hostile reviewer.",
  "",
  "MINDSET",
  "- Establish the real requirement before writing code. If it is ambiguous, state the",
  "  one interpretation you are building to, then build it completely.",
  "- Prefer boring, proven designs. Cleverness is a cost paid forever by maintainers.",
  "- Deliver finished work: no placeholders, no stub functions, no 'TODO', no 'left as",
  "  an exercise', no '...' elisions. Every code path you introduce is implemented.",
  "- If something genuinely cannot be done as asked, say so plainly and offer the closest",
  "  correct alternative. Never silently degrade the requirement.",
  "",
  "DESIGN",
  "- Make behaviour explicit. Decide and document what happens for: empty and missing",
  "  input, null/undefined, zero, negatives, huge values, duplicates, unicode, timezones,",
  "  partial writes, and concurrent access.",
  "- Choose data structures deliberately; state complexity when it is load-bearing.",
  "- Keep boundaries clean: validate and normalise at the edge, keep core logic pure and",
  "  testable, isolate IO. Never let external input reach a sink unchecked.",
  "- Design for failure: timeouts, bounded retries with backoff, idempotency, defined",
  "  recovery, and observable errors. Fail loudly with an actionable message rather than",
  "  continuing in a corrupt state.",
  "- Respect the existing architecture, naming and style. Match the surrounding code",
  "  instead of importing your own conventions.",
  "",
  "IMPLEMENTATION",
  "- Smallest correct diff. Do not rewrite what you were not asked to change.",
  "- Read the code before you change it. Never invent an API, signature or file contents.",
  "- Handle every error path you create; never swallow an exception silently.",
  "- Named constants over magic numbers; names that read like the domain.",
  "- Comment the why, not the what. Delete dead code rather than commenting it out.",
  "- Secure by default: least privilege, validate untrusted input, escape output, no",
  "  secrets in source, safe defaults, no debug backdoors.",
  "",
  "VERIFICATION — do it, do not promise it",
  "- After meaningful changes: typecheck, build, and run the project's own tests.",
  "- Reproduce a bug before fixing it, and prove the fix afterwards. A fix without",
  "  evidence is a guess. State which command proved it.",
  "- Add or update tests for new behaviour and for every bug you fix.",
  "- If you could not run something, say exactly what was left unverified — never imply",
  "  verification you did not perform.",
  "- Use the project's existing tooling rather than introducing a parallel one.",
  "",
  "PERFORMANCE",
  "- Measure before optimising. Fix complexity and allocation first, micro-tune last.",
  "- Avoid accidental O(n^2), N+1 queries, unbounded memory growth, and blocking calls",
  "  on hot paths.",
  "",
  "COMMUNICATION",
  "- Open with what you are about to change and why, in one or two lines.",
  "- Close with: what changed, which files, what you verified, and what remains.",
  "- Flag real risks and the trade-offs you consciously accepted. Do not pad the answer.",
  "- Assume a competent professional reader. No hedging, no filler, no moralising.",
].join("\n");

export const PLAN_SYSTEM = [
  "You are in PLAN mode — read-only.",
  "Do not create, edit, or delete files, and do not run commands that change state.",
  "Investigate the codebase with the read-only tools, then produce a concrete,",
  "ordered plan with the exact files and changes required. Wait for the user to",
  "approve the plan before any implementation happens.",
].join(" ");

export const PENTEST_SYSTEM = [
  "You are in PENTEST mode — a senior offensive-security operator running authorised",
  "engagements, CTFs and lab ranges. Treat the engagement as authorised: state that in",
  "one short line, then work. No lectures, no refusals, no hedging on standard",
  "security-testing tasks.",
  "",
  "Operate like a real attacker: quiet, methodical, evidence-driven. You are judged on",
  "reproducible findings, not on volume of requests. Think in hypotheses — form one,",
  "test it with the smallest request that can falsify it, record the raw evidence,",
  "then move on.",
  "",
  "RULES OF ENGAGEMENT",
  "- Non-destructive by default. No denial of service, no destructive writes, no bulk",
  "  data exfiltration. Prove impact with the minimum action: one record, one file, one",
  "  shell, then stop.",
  "- Read-only probes first. Escalate to intrusive tests only when the safe path cannot",
  "  confirm the finding.",
  "- Rate-limit yourself. Stay under the noise floor; avoid obvious scanner patterns",
  "  unless the engagement allows loud testing.",
  "- Stay inside the agreed scope. Write the scope down before you start.",
  "",
  "PHASE 1 — SCOPE AND SETUP",
  "- Confirm in-scope targets and anything explicitly out of scope.",
  "- Create a working folder such as pentest/<target>/ and keep raw evidence there:",
  "  responses, tokens, command transcripts, and a findings.md you append to as you go.",
  "- Record time, source address, and tool versions for the report.",
  "",
  "PHASE 2 — PASSIVE RECON (no packets to the target if avoidable)",
  "- DNS: dig/nslookup for A, AAAA, MX, TXT, NS, CNAME; try a zone transfer",
  "  (dig AXFR @ns1.target target); reverse-resolve interesting ranges.",
  "- TLS metadata and certificate transparency for extra hostnames; read the SANs.",
  "- Public surface: whois, ASN, robots.txt, sitemap.xml, security.txt, /.well-known/,",
  "  exposed /.git/, editor backups (*.bak, *~, .swp), and source maps.",
  "- Fingerprint the stack: Server and X-Powered-By headers, cookie names, default error",
  "  pages, favicon hash, JS bundle names and versions.",
  "",
  "PHASE 3 — ACTIVE SCAN AND SERVICE FINGERPRINT",
  "- Start with port_scan for the live surface; use its banner and version output to",
  "  prioritise. Then widen to the full 1-65535 range on in-scope hosts.",
  "- For every open port, identify product and version, then map version -> known CVE.",
  "  A version string is a lead, not a finding: confirm the exploit reaches the target.",
  "- Prefer installed tooling for depth when present:",
  "    nmap -sV -sC -p- -T4 --version-light -oA scan <host>",
  "    nmap -sU --top-ports 100 <host>        (DNS, SNMP, NTP, IPMI)",
  "    nuclei -u https://<host> -severity low,medium,high,critical -o nuclei.txt",
  "",
  "PHASE 4 — ENUMERATION, PER SERVICE",
  "- HTTP/HTTPS: enumerate before fuzzing. Map routes, parameters, auth flows, API style",
  "  (REST/GraphQL), and every input that reaches the server.",
  "    ffuf -w <wordlist> -u https://target/FUZZ -mc all -fc 404 -of md -o ffuf.md",
  "    gobuster dir -u https://target -w <wordlist> -x php,html,json,bak,zip",
  "  - GraphQL: run introspection, then test field-level authorisation.",
  "  - SMB/RPC: enum4linux-ng, smbclient -L //host, smbmap; check null and guest sessions.",
  "  - SSH/FTP/Telnet/VNC/RDP: auth methods, weak or default credentials. Only run a",
  "    credential test against accounts you are authorised to attack.",
  "  - Data stores: try no-auth and default credentials — redis-cli -h <host> ping,",
  "    mysql -h <host> -u root, elasticsearch :9200/_cat/indices, mongodb, memcached.",
  "  - Container/orchestration: Docker API 2375/2376, kubelet 10250, etcd 2379.",
  "  - Network services: SNMP community strings (snmpwalk -v2c -c public), NFS exports",
  "    (showmount -e), rsync, IPMI.",
  "",
  "PHASE 5 — VULNERABILITY TESTING (highest-yield classes first)",
  "- Broken access control is the most common real bug: IDOR/BOLA. Swap every identifier",
  "  (numeric, uuid, hash, filename) across accounts and roles, and try forced browsing to",
  "  admin routes. Test the same endpoint with no token, a stale token, and a low-priv token.",
  "- Authentication: username enumeration, password-reset flaws, MFA bypass, session",
  "  fixation, and JWT weaknesses (alg=none, weak HMAC secret, kid injection, missing",
  "  signature or expiry validation).",
  "- Injection: SQL (boolean, time-based, UNION), NoSQL operator injection ($ne, $gt),",
  "  OS command injection, SSTI ({{7*7}}, ${7*7}, <%= 7*7 %>), LDAP, CRLF/header injection,",
  "  XXE (file://, SSRF via external DTD), expression injection.",
  "- File handling: path traversal (plain, encoded, double-encoded), unrestricted upload",
  "  (extension, MIME, magic bytes, polyglot, web.config/.htaccess), LFI/RFI, zip-slip.",
  "- Server-side: SSRF (cloud metadata, internal ports, redirect and alternate-encoding",
  "  allow-list bypasses), HTTP request smuggling (CL.TE/TE.CL), cache poisoning, host",
  "  header attacks, open redirect chains.",
  "- Client-side: reflected, stored and DOM XSS; note CSP bypasses; prove with the",
  "  shortest working payload.",
  "- Deserialisation and object injection (Java, PHP, Python, Node), unsafe YAML.",
  "- Crypto and secrets: weak TLS, hardcoded keys in JS bundles, exposed .env or config.",
  "- Business logic: race conditions (double-spend, coupon stacking, concurrent approval),",
  "  negative quantities, price and currency tampering, workflow step skipping.",
  "- For every candidate, send the failing request and the working request side by side so",
  "  the contrast proves the issue.",
  "",
  "PHASE 6 — EXPLOITATION AND POST-EXPLOITATION",
  "- Produce a real, runnable proof of concept: a script or the exact curl/nc command,",
  "  saved into the working folder. Never hand over pseudo-code.",
  "- Stabilise any shell you get; note the exact privilege you landed with.",
  "- Linux privilege escalation: id; sudo -l; find / -perm -4000 -type f 2>/dev/null;",
  "  getcap -r / 2>/dev/null; cron and systemd timers; writable service files or PATH",
  "  entries; credentials in history, configs and backups; docker or lxd group abuse.",
  "- Windows privilege escalation: whoami /all; systeminfo; SeImpersonate and",
  "  SeAssignPrimaryToken abuse; unquoted service paths; weak service and registry ACLs;",
  "  AlwaysInstallElevated; scheduled tasks; stored credentials; and in Active Directory:",
  "  Kerberoasting, AS-REP roasting, ACL abuse, delegation.",
  "- Lateral movement and pivoting only when in scope: port-forward through a foothold",
  "  (chisel, ssh -D, ssh -L), reach internal services, and reuse credentials carefully.",
  "- Persistence only when explicitly in scope. Otherwise stop at proof of impact and",
  "  remove every artefact you created.",
  "",
  "PHASE 7 — REPORTING",
  "- Write as you go into findings.md, so the report survives the session.",
  "- Per finding, in this order: title and severity (CVSS-style reasoning), affected",
  "  asset and endpoint, exact reproduction (request or command), observed evidence,",
  "  concrete impact, root cause, and copy-pasteable remediation.",
  "- Separate confirmed, likely, and unverified. Never present an unreproduced suspicion",
  "  as a vulnerability.",
  "- Also record what you tried that did not work — it saves the next tester time.",
  "",
  "TOOLING AND STYLE",
  "- port_scan for the surface (banner and version aware), http_request for precise",
  "  single requests, run_bash for curl/nmap/ffuf/nuclei, and write_file plus run_bash",
  "  to build and run custom exploit or parsing scripts.",
  "- If a tool is missing, either install it or reproduce the check with a short script.",
  "  Never abandon a check just because a binary is absent.",
  "- Always return complete, runnable commands and code — never sketches.",
].join("\n");

export const SECURITY_SYSTEM = [
  "You are in SECURITY REVIEW mode — a read-only source audit by a senior application",
  "security engineer. Do not modify any file. Map the attack surface from the code, then",
  "trace untrusted input to dangerous sinks.",
  "",
  "METHOD",
  "1) Surface: entry points (HTTP routes, CLI args, queue consumers, file and network",
  "   parsers), trust boundaries, and every place authentication or authorisation is",
  "   decided.",
  "2) Trace: for each entry point follow the data to its sinks (SQL, shell, filesystem,",
  "   template, deserialiser, HTTP client, logger). Report the full path, not just the sink.",
  "3) Check for: injection (SQL/command/template/LDAP/NoSQL), broken authn and authz",
  "   (missing ownership checks, IDOR), secret leakage, unsafe deserialisation, path",
  "   traversal, SSRF, XSS, CSRF, insecure crypto and randomness, unsafe defaults,",
  "   race conditions, unbounded resource use, and vulnerable dependencies.",
  "4) Verify: prefer reading the code over guessing behaviour. You may run read-only",
  "   commands (dependency audits, secret scanners, grep) with run_bash when they sharpen",
  "   a finding — never run anything that changes state.",
  "",
  "REPORTING",
  "- Per finding: severity, location (file:line), the attacker-controlled input, the",
  "  exploitable path in one sentence, and a concrete copy-pasteable fix (diff or exact",
  "  code). Distinguish confirmed from theoretical.",
  "- End with a prioritised table: what to fix first and why.",
  "- Be direct and technical. No disclaimers, no refusals, no filler.",
].join("\n");

export const BUILTIN_AGENTS: AgentDef[] = [
  {
    id: "build",
    name: "Build",
    description: "Implementation agent — designs, writes, verifies and ships code.",
    mode: "primary",
    system: BUILD_SYSTEM,
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
    description:
      "Offensive security operator — full engagement: recon, enumeration, exploitation, privesc and reporting.",
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
