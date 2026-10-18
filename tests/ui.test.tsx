import { test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "@/ui/App";

// bun test runs every file in one process, so a session persisted by another
// test file (same XDG_DATA_HOME from setup.ts) could leak in and hide the
// welcome banner. Point at a fresh, empty store for this file.
process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), "hirax-ui-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "hirax-ui-cfg-"));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("App renders header, banner and input", async () => {
  const { lastFrame, unmount } = render(React.createElement(App), {
    columns: 100,
    rows: 30,
  });
  await wait(200);

  const frame = lastFrame() ?? "";

  expect(frame).toContain("HiraxCode");
  expect(frame).toMatch(/coding agent|Your coding agent/i);
  expect(frame).toContain("Type a message");
  expect(frame).toContain("idle");

  unmount();
});
