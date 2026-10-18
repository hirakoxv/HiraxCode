#!/usr/bin/env node
import { render } from "ink";
import React from "react";
import { App } from "./ui/App";
import { disableMouseTracking } from "./ui/lib/terminal";
import { stopLlamaServer } from "./providers/llama";
import { logger } from "./utils/logger";

process.on("uncaughtException", (err) => logger.error("uncaughtException", err));
process.on("unhandledRejection", (reason) =>
  logger.error("unhandledRejection", reason),
);

let stopping = false;
function shutdown(code = 0): never {
  if (stopping) process.exit(code);
  stopping = true;
  disableMouseTracking();
  stopLlamaServer();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => {
  disableMouseTracking();
  stopLlamaServer();
});

// Ink needs an interactive terminal (raw mode). Fail with a clear message
// instead of a raw-mode stack trace when stdin is not a TTY.
const rawModeSupported =
  Boolean(process.stdin.isTTY) || process.env.HIRAX_FORCE_TTY === "1";

if (!rawModeSupported) {
  process.stderr.write(
    [
      "",
      "HiraxCode needs an interactive terminal (TTY).",
      "",
      "It looks like stdin is not a TTY — for example you piped input or are",
      "running it from a script/CI. Run `hiraxcode` directly in your terminal.",
      "",
      `(Logs: ${logger.path ?? "~/.local/state/hiraxcode/hiraxcode.log"})`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}

let waitUntilExit: () => Promise<void>;
try {
  disableMouseTracking();
  ({ waitUntilExit } = render(React.createElement(App)));
} catch (err) {
  process.stderr.write(`\nFailed to start HiraxCode: ${(err as Error).message}\n`);
  process.exit(1);
}

await waitUntilExit();
shutdown(0);
