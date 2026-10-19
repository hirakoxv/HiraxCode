import { test, expect, beforeAll, afterAll } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch() {
      const body =
        `data: ${JSON.stringify({
          id: "1",
          object: "chat.completion.chunk",
          created: 0,
          model: "mock",
          choices: [
            { index: 0, delta: { role: "assistant", content: "Hello from mock!" }, finish_reason: null },
          ],
        })}\n\n` +
        `data: ${JSON.stringify({
          id: "1",
          object: "chat.completion.chunk",
          created: 0,
          model: "mock",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n` +
        "data: [DONE]\n\n";

      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });

  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.BASE_URL = `http://localhost:${server.port}/v1`;
  process.env.MODEL = "mock/model";
  process.env.ENABLE_REASONING = "false";
});

afterAll(() => server.stop(true));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("typing a message streams a reply into the UI", async () => {
  const { App } = await import("@/ui/App");
  const { lastFrame, stdin, unmount } = render(React.createElement(App), {
    columns: 100,
    rows: 30,
  });

  await wait(200);
  stdin.write("hi there");
  await wait(50);
  stdin.write("\r");

  await wait(600);
  const frame = lastFrame() ?? "";

  expect(frame).toContain("hi there");
  expect(frame).toContain("Hello from mock!");

  unmount();
});

test("backspace removes an attachment when the prompt is empty", async () => {
  const { App } = await import("@/ui/App");
  const { lastFrame, stdin, unmount } = render(React.createElement(App), {
    columns: 100,
    rows: 30,
  });

  await wait(200);

  const dir = mkdtempSync(join(tmpdir(), "hirax-attach-"));
  const file = join(dir, "shot.png");
  writeFileSync(file, Buffer.from("89504e470d0a1a0a", "hex"));

  // Attach through the command so no clipboard is involved.
  stdin.write(`/paste ${file}`);
  await wait(80);
  stdin.write("\r");
  await wait(150);
  expect(lastFrame() ?? "").toContain("1 image attached");

  // Backspace on the (empty) prompt drops it again.
  stdin.write("\x7f");
  await wait(150);
  expect(lastFrame() ?? "").not.toContain("1 image attached");

  unmount();
});
