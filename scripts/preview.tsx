// Renders the App to a static frame so the layout can be inspected without a
// terminal. Usage: bun run scripts/preview.tsx [rows] [cols] [mode]
//   mode: empty | help | settings | sidebar
import React from "react";
import { render } from "ink-testing-library";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), "hirax-prev-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "hirax-prev-cfg-"));

const rows = Number(process.argv[2] ?? 30);
const cols = Number(process.argv[3] ?? 100);
const mode = process.argv[4] ?? "empty";

const { App } = await import("@/ui/App");
const { lastFrame, stdin, unmount } = render(React.createElement(App), {
  columns: cols,
  rows,
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
await wait(250);

if (mode === "help") {
  stdin.write("/help\r");
  await wait(200);
} else if (mode === "settings") {
  stdin.write("/settings\r");
  await wait(200);
} else if (mode === "sidebar") {
  stdin.write("\t");
  await wait(200);
} else if (mode === "commands") {
  stdin.write("/");
  await wait(200);
} else if (mode === "chat") {
  stdin.write("hello there this is a fairly long message to see how wrapping behaves in the transcript\r");
  await wait(400);
}

console.log("=".repeat(cols));
console.log(lastFrame() ?? "(no frame)");
console.log("=".repeat(cols));
unmount();
process.exit(0);
