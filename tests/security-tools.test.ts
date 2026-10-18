import { test, expect, beforeAll, afterAll } from "bun:test";
import { executeTool, parsePorts } from "@/agent/tools";

/**
 * A tiny local HTTP server used to exercise `http_request` and `port_scan`
 * without touching the network.
 */
let server: ReturnType<typeof Bun.serve>;
let port = 0;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/secret") {
        return new Response("top secret", { status: 403, headers: { "x-test": "yes" } });
      }
      if (url.pathname === "/echo" && req.method === "POST") {
        return new Response(`method=${req.method}`);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  port = server.port!;
});

afterAll(() => {
  server.stop(true);
});

test("parsePorts expands lists and ranges", () => {
  expect(parsePorts("22,80")).toEqual([22, 80]);
  expect(parsePorts("1000-1003")).toEqual([1000, 1001, 1002, 1003]);
  expect(parsePorts("443, 22, 22")).toEqual([22, 443]);
  expect(parsePorts("0,70000,bad")).toEqual([]);
});

test("http_request returns the status line, headers and body", async () => {
  const r = await executeTool("http_request", { url: `http://localhost:${port}/` }, process.cwd());
  expect(r.success).toBe(true);
  expect(r.output).toContain("HTTP 200");
  expect(r.output).toContain("content-type");
  expect(r.output).toContain('"ok":true');
});

test("http_request captures non-2xx responses without failing", async () => {
  const r = await executeTool(
    "http_request",
    { url: `http://localhost:${port}/secret` },
    process.cwd(),
  );
  expect(r.success).toBe(true);
  expect(r.output).toContain("HTTP 403");
  expect(r.output).toContain("x-test: yes");
  expect(r.output).toContain("top secret");
});

test("http_request sends a POST body", async () => {
  const r = await executeTool(
    "http_request",
    { url: `http://localhost:${port}/echo`, method: "POST", body: "hi" },
    process.cwd(),
  );
  expect(r.success).toBe(true);
  expect(r.output).toContain("method=POST");
});

test("http_request rejects non-http urls", async () => {
  const r = await executeTool("http_request", { url: "ftp://example.com" }, process.cwd());
  expect(r.success).toBe(false);
  expect(r.error).toContain("http");
});

test("port_scan finds an open port and reports it", async () => {
  const r = await executeTool(
    "port_scan",
    { host: "127.0.0.1", ports: String(port), timeout: 1000 },
    process.cwd(),
  );
  expect(r.success).toBe(true);
  expect(r.output).toContain("1 open");
  expect(r.output).toContain(`open  ${port}`);
});

test("port_scan reports when nothing is open", async () => {
  const r = await executeTool(
    "port_scan",
    { host: "127.0.0.1", ports: "1", timeout: 200 },
    process.cwd(),
  );
  expect(r.success).toBe(true);
  // Port 1 is never served by the test, so it should be closed here.
  expect(r.output).toContain("no open ports");
});

test("port_scan rejects an unresolvable host", async () => {
  const r = await executeTool(
    "port_scan",
    { host: "nonexistent.invalid", ports: "80", timeout: 200 },
    process.cwd(),
  );
  expect(r.success).toBe(false);
});
