import { test, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { InputBox } from "@/ui/components/InputBox";
import { MessageList } from "@/ui/components/MessageList";
import type { Message } from "@/core/types";

const noop = () => {};

test("InputBox shows an attachment indicator", () => {
  const { lastFrame, unmount } = render(
    React.createElement(InputBox, {
      disabled: false,
      focused: true,
      accent: "#22d3ee",
      value: "",
      onChange: noop,
      onSubmit: noop,
      approval: null,
      onApproval: noop,
      attachments: [{ mime: "image/png", data: "QUJD", name: "clipboard-1.png" }],
    }),
    { columns: 100, rows: 20 },
  );

  const frame = lastFrame() ?? "";
  expect(frame).toContain("1 image attached");
  expect(frame).toContain("clipboard-1.png");
  unmount();
});

test("a rejected submit keeps the draft (onSubmit === false)", async () => {
  let calls = 0;
  const { stdin, lastFrame, unmount } = render(
    React.createElement(InputBox, {
      disabled: false,
      focused: true,
      accent: "#22d3ee",
      value: "",
      onChange: noop,
      onSubmit: () => {
        calls++;
        return false;
      },
      approval: null,
      onApproval: noop,
      attachments: [],
    }),
    { columns: 100, rows: 20 },
  );

  await new Promise((r) => setTimeout(r, 60));
  stdin.write("hi there");
  await new Promise((r) => setTimeout(r, 60));
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 60));

  expect(calls).toBe(1);
  // The rejected draft is preserved, not cleared.
  expect(lastFrame() ?? "").toContain("hi there");
  unmount();
});

test("MessageList renders an image chip on user messages", () => {
  const message: Message = {
    id: "u1",
    role: "user",
    content: "what is this?",
    timestamp: 0,
    done: true,
    images: [{ mime: "image/png", data: "QUJD", name: "shot.png" }],
  };

  const { lastFrame, unmount } = render(
    React.createElement(MessageList, {
      messages: [message],
      running: false,
      streamingThought: "",
      streamingContent: "",
      activeTool: null,
      compact: false,
      accent: "#22d3ee",
      providerName: "OpenAI",
      model: "gpt-4.1",
      hasKey: true,
    }),
    { columns: 100, rows: 30 },
  );

  const frame = lastFrame() ?? "";
  expect(frame).toContain("what is this?");
  expect(frame).toContain("1 image");
  expect(frame).toContain("shot.png");
  unmount();
});
