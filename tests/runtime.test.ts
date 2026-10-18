import { test, expect } from "bun:test";
import { createServer } from "node:net";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { findFreePort, sleep, spawn, which } from "@/utils/runtime";

// ── which ───────────────────────────────────────────────────────────────────

test("which finds the running node executable", () => {
  expect(which(process.platform === "win32" ? "node.exe" : "node")).toBeTruthy();
});

test("which resolves an explicit path", () => {
  expect(which(process.execPath)).toBe(process.execPath);
});

test("which returns null for something that is not on PATH", () => {
  expect(which("hiraxcode-definitely-not-a-real-binary-xyz")).toBeNull();
});

test("which returns null for an explicit path that does not exist", () => {
  expect(which("./no/such/binary-xyz")).toBeNull();
});

// ── sleep ───────────────────────────────────────────────────────────────────

test("sleep waits roughly the requested time", async () => {
  const started = Date.now();
  await sleep(40);
  expect(Date.now() - started).toBeGreaterThanOrEqual(25);
});

// ── spawn ───────────────────────────────────────────────────────────────────

test("spawn streams stdout/stderr and reports a zero exit code", async () => {
  const proc = spawn(
    [process.execPath, "-e", "process.stdout.write('out'); process.stderr.write('err')"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(out).toBe("out");
  expect(err).toBe("err");
  expect(code).toBe(0);
  expect(proc.pid).toBeGreaterThan(0);
});

test("spawn reports a non-zero exit code", async () => {
  const proc = spawn([process.execPath, "-e", "process.exit(3)"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await proc.exited).toBe(3);
});

test("spawn pipes stdin through to the child", async () => {
  const proc = spawn([process.execPath, "-e", "process.stdin.pipe(process.stdout)"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin?.write("piped-bytes");
  proc.stdin?.end();
  expect(await new Response(proc.stdout).text()).toBe("piped-bytes");
  expect(await proc.exited).toBe(0);
});

test("spawn honours cwd", async () => {
  const proc = spawn([process.execPath, "-e", "process.stdout.write(process.cwd())"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  expect(realpathSync(out).toLowerCase()).toBe(realpathSync(process.cwd()).toLowerCase());
});

test("spawn passes a custom env without inheriting the rest", async () => {
  const proc = spawn([process.execPath, "-e", "process.stdout.write(String(process.env.HIRAX_TEST_VAR))"], {
    env: { HIRAX_TEST_VAR: "env-ok" },
    stdout: "pipe",
    stderr: "ignore",
  });
  expect((await new Response(proc.stdout).text()).trim()).toBe("env-ok");
  await proc.exited;
});

test("spawn kill stops a long-running process", async () => {
  const proc = spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.kill();
  expect(typeof (await proc.exited)).toBe("number");
});

// ── findFreePort ────────────────────────────────────────────────────────────

test("findFreePort skips a port that is already in use", async () => {
  const busy = createServer();
  await new Promise<void>((resolve) => busy.listen(0, "127.0.0.1", resolve));
  const takenPort = (busy.address() as AddressInfo).port;

  try {
    const free = await findFreePort(takenPort, 10);
    expect(free).toBeGreaterThan(takenPort);

    // The port it handed back must actually be bindable.
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(free, "127.0.0.1", resolve);
    });
    probe.close();
  } finally {
    busy.close();
  }
});

test("findFreePort gives up when every port is taken", async () => {
  const busy = createServer();
  await new Promise<void>((resolve) => busy.listen(0, "127.0.0.1", resolve));
  const takenPort = (busy.address() as AddressInfo).port;
  try {
    await expect(findFreePort(takenPort, 1)).rejects.toThrow("No free port found");
  } finally {
    busy.close();
  }
});

// ── sanity ──────────────────────────────────────────────────────────────────

test("tmpdir is readable (environment sanity)", () => {
  expect(tmpdir().length).toBeGreaterThan(0);
});
