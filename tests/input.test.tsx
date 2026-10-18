import { test, expect } from "bun:test";
import React, { useState } from "react";
import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { sanitizeInput, isPrintableInput } from "@/ui/lib/input";
import { TextInput } from "@/ui/components/TextInput";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── sanitizeInput ───────────────────────────────────────────────────────────

test("sanitizeInput drops SGR mouse reports (scroll/click)", () => {
  expect(sanitizeInput("[<65;66;31M")).toBe(""); // scroll down
  expect(sanitizeInput("[<64;61;36M")).toBe(""); // scroll up
  expect(sanitizeInput("[<0;10;5M")).toBe(""); // left click
  expect(sanitizeInput("[<0;10;5m")).toBe(""); // release
  // Terminals can deliver several reports in one read.
  expect(sanitizeInput("[<65;66;31M[<65;66;31M[<64;61;36M")).toBe("");
});

test("sanitizeInput drops X10/urxvt mouse and bracketed-paste markers", () => {
  expect(sanitizeInput("[M !!")).toBe("");
  expect(sanitizeInput("[32;10;5M")).toBe("");
  expect(sanitizeInput("[200~hello[201~")).toBe("hello");
});

test("sanitizeInput drops partial mouse fragments and bracketed paste", () => {
  expect(sanitizeInput("[<65;66;")).toBe(""); // read split mid-sequence
  expect(sanitizeInput("[<65")).toBe("");
  expect(sanitizeInput("[<")).toBe("");
  expect(sanitizeInput("[200~hello[201~")).toBe("hello");
});

test("sanitizeInput keeps ordinary text, including brackets", () => {
  expect(sanitizeInput("hello")).toBe("hello");
  expect(sanitizeInput("[")).toBe("[");
  expect(sanitizeInput("[a")).toBe("[a");
  expect(sanitizeInput("a[0]")).toBe("a[0]");
  expect(sanitizeInput("[M")).toBe("[M");
});

test("sanitizeInput strips stray control characters", () => {
  expect(sanitizeInput("a\u0007b")).toBe("ab");
  expect(sanitizeInput("a\u001bb")).toBe("ab");
});

test("isPrintableInput reflects sanitizeInput", () => {
  expect(isPrintableInput("[<65;66;31M")).toBe(false);
  expect(isPrintableInput("x")).toBe(true);
});

// ── TextInput ───────────────────────────────────────────────────────────────

function Harness() {
  const [value, setValue] = useState("");
  return (
    <Box flexDirection="column">
      <TextInput value={value} onChange={setValue} onSubmit={() => {}} />
      <Text>{`VALUE:${value}`}</Text>
    </Box>
  );
}

test("TextInput types text but ignores mouse escape sequences", async () => {
  const { lastFrame, stdin, unmount } = render(React.createElement(Harness));
  await wait(80);

  stdin.write("hi");
  await wait(30);
  expect(lastFrame() ?? "").toContain("VALUE:hi");

  // A burst of wheel events must not end up in the value.
  stdin.write("\u001b[<65;66;31M");
  stdin.write("\u001b[<65;66;31M");
  stdin.write("\u001b[<64;61;36M");
  await wait(30);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("VALUE:hi");
  expect(frame).not.toContain("[<");

  // Real typing still works afterwards.
  stdin.write("!");
  await wait(30);
  expect(lastFrame() ?? "").toContain("VALUE:hi!");

  unmount();
});

test("TextInput supports cursor movement and deletion", async () => {
  const { lastFrame, stdin, unmount } = render(React.createElement(Harness));
  await wait(80);

  stdin.write("abc");
  await wait(20);
  // Left, then delete the character under the cursor ("b").
  stdin.write("\u001b[D");
  await wait(20);
  stdin.write("\u007f");
  await wait(20);
  expect(lastFrame() ?? "").toContain("VALUE:ac");

  // Ctrl+W deletes the trailing word (leaving preceding whitespace, like bash).
  stdin.write(" xyz");
  await wait(20);
  stdin.write("\u0017");
  await wait(20);
  const afterCtrlW = lastFrame() ?? "";
  expect(afterCtrlW).toContain("VALUE:a c");
  expect(afterCtrlW).not.toContain("xyz");

  unmount();
});
