import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  agentSystemPrompt,
  loadAgents,
  parseFrontmatter,
  resolveAgent,
  selectableAgents,
  toolsForAgent,
  BUILTIN_AGENTS,
} from "@/core/agents";
import { allTools } from "@/agent/tools";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "hirax-agents-"));
});

test("built-in agents are always available", () => {
  const agents = loadAgents(workdir);
  const ids = agents.map((a) => a.id);
  for (const id of BUILTIN_AGENTS.map((a) => a.id)) expect(ids).toContain(id);
});

test("an unknown agent id falls back to build", () => {
  const agents = loadAgents(workdir);
  expect(resolveAgent(agents, "does-not-exist").id).toBe("build");
  expect(resolveAgent(agents, "plan").id).toBe("plan");
});

test("plan mode is read-only", () => {
  const plan = resolveAgent(loadAgents(workdir), "plan");
  const names = toolsForAgent(plan, allTools).map((t) => t.name);
  expect(names).toEqual(["read_file", "list_dir", "glob"]);
  expect(names).not.toContain("write_file");
  expect(names).not.toContain("run_bash");
});

test("build mode keeps every tool", () => {
  const build = resolveAgent(loadAgents(workdir), "build");
  expect(toolsForAgent(build, allTools).length).toBe(allTools.length);
});

test("build agent carries the rigorous engineering prompt", () => {
  const build = resolveAgent(loadAgents(workdir), "build");
  const prompt = agentSystemPrompt(build, "BASE");
  expect(prompt).toContain("BUILD mode");
  expect(prompt).toContain("VERIFICATION");
  expect(prompt).toContain("Smallest correct diff");
});

test("pentest agent prompt is a phased engagement playbook", () => {
  const pentest = resolveAgent(loadAgents(workdir), "pentest");
  const prompt = agentSystemPrompt(pentest, "BASE");
  for (const phase of ["PHASE 1", "PHASE 3", "PHASE 5", "PHASE 7"]) {
    expect(prompt).toContain(phase);
  }
  expect(prompt).toContain("RULES OF ENGAGEMENT");
  expect(prompt).toContain("IDOR");
  expect(prompt).toContain("findings.md");
});

test("pentest agent offers recon tools and a security prompt", () => {
  const pentest = resolveAgent(loadAgents(workdir), "pentest");
  const names = toolsForAgent(pentest, allTools).map((t) => t.name);
  expect(names).toContain("http_request");
  expect(names).toContain("port_scan");
  // Can save the scripts/reports it generates.
  expect(names).toContain("write_file");
  expect(names).toContain("edit_file");
  expect(names).toEqual([
    "read_file",
    "list_dir",
    "glob",
    "edit_file",
    "write_file",
    "run_bash",
    "http_request",
    "port_scan",
  ]);
  expect(agentSystemPrompt(pentest, "BASE")).toContain("PENTEST mode");
});

test("security agent is read-only (no write/edit tools)", () => {
  const security = resolveAgent(loadAgents(workdir), "security");
  const names = toolsForAgent(security, allTools).map((t) => t.name);
  expect(names).not.toContain("write_file");
  expect(names).not.toContain("edit_file");
  expect(names).toContain("read_file");
  expect(agentSystemPrompt(security, "BASE")).toContain("SECURITY REVIEW mode");
});

test("pentest and security are selectable primary agents", () => {
  const ids = selectableAgents(loadAgents(workdir)).map((a) => a.id);
  expect(ids).toContain("pentest");
  expect(ids).toContain("security");
});

test("agent system prompt is appended to the base", () => {
  const plan = resolveAgent(loadAgents(workdir), "plan");
  const prompt = agentSystemPrompt(plan, "BASE");
  expect(prompt).toContain("BASE");
  expect(prompt).toContain("PLAN mode");
  expect(agentSystemPrompt(undefined, "BASE")).toBe("BASE");
});

test("parseFrontmatter reads scalars, inline and block lists", () => {
  const { data, body } = parseFrontmatter(
    [
      "---",
      "description: Reviews code",
      "mode: subagent",
      "model: anthropic/claude-sonnet-4-5",
      "tools: [read_file, glob]",
      "deny:",
      "  - run_bash",
      "  - write_file",
      "---",
      "Do the review.",
    ].join("\n"),
  );

  expect(data.description).toBe("Reviews code");
  expect(data.mode).toBe("subagent");
  expect(data.model).toBe("anthropic/claude-sonnet-4-5");
  expect(data.tools).toEqual(["read_file", "glob"]);
  expect(data.deny).toEqual(["run_bash", "write_file"]);
  expect(body).toBe("Do the review.");
});

test("project markdown agents are discovered (.hiraxcode/agents)", () => {
  const dir = join(workdir, ".hiraxcode", "agents", "team");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "reviewer.md"),
    [
      "---",
      "description: Reviews changes",
      "mode: primary",
      "tools: [read_file, glob]",
      "temperature: 0.1",
      "---",
      "Review only. Do not edit.",
    ].join("\n"),
    "utf-8",
  );

  const agents = loadAgents(workdir);
  const reviewer = agents.find((a) => a.id === "team/reviewer");
  expect(reviewer).toBeDefined();
  expect(reviewer!.source).toBe("project");
  expect(reviewer!.temperature).toBe(0.1);
  expect(reviewer!.system).toBe("Review only. Do not edit.");
  expect(toolsForAgent(reviewer, allTools).map((t) => t.name)).toEqual([
    "read_file",
    "glob",
  ]);

  // Subagents are not selectable as the primary agent.
  writeFileSync(
    join(dir, "helper.md"),
    "---\nmode: subagent\n---\nhelp",
    "utf-8",
  );
  const ids = selectableAgents(loadAgents(workdir)).map((a) => a.id);
  expect(ids).toContain("team/reviewer");
  expect(ids).not.toContain("team/helper");

  rmSync(workdir, { recursive: true, force: true });
});
