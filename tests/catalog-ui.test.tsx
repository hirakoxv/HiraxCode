import { test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import React from "react";
import { render } from "ink-testing-library";

// Isolate sessions/config and keep the models.dev refresh off the network.
process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), "hirax-cat-ui-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "hirax-cat-ui-cfg-"));
process.env.HIRAX_NO_REFRESH = "1";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openCommand(command: string) {
  const { App } = await import("@/ui/App");
  const ui = render(React.createElement(App), { columns: 100, rows: 30 });
  await wait(200);
  ui.stdin.write(command);
  await wait(50);
  ui.stdin.write("\r");
  await wait(200);
  return ui;
}

test("the provider picker lists the full models.dev catalog", async () => {
  const ui = await openCommand("/provider");
  const frame = ui.lastFrame() ?? "";

  expect(frame).toContain("Select provider");
  const match = /(\d+)\/(\d+)/.exec(frame);
  expect(match).toBeTruthy();
  expect(Number(match![2])).toBeGreaterThan(100);

  // Typing filters the list, and catalog-only providers are present.
  ui.stdin.write("deepseek");
  await wait(120);
  expect(ui.lastFrame() ?? "").toContain("DeepSeek");

  ui.unmount();
});

test("the agent picker offers the built-in agents", async () => {
  const ui = await openCommand("/agent");
  const frame = ui.lastFrame() ?? "";

  expect(frame).toContain("Select agent");
  expect(frame).toContain("Plan");
  expect(frame).toContain("Build");

  ui.unmount();
});
