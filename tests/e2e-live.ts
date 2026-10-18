import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
const dir = mkdtempSync(join(tmpdir(), "hirax-e2e-"));
process.env.XDG_CONFIG_HOME = dir;
process.env.XDG_DATA_HOME = dir;

import { GeminiProvider } from "@/providers/gemini";
import { ToolRegistry } from "@/agent/tool-registry";
import { readFileSync } from "fs";
import { homedir } from "os";

const real = JSON.parse(
  readFileSync(`${homedir()}/.config/hiraxcode/config.json`, "utf-8"),
);
const key = real.apiKeys.google;
const model = process.argv[2] ?? "gemini-3.6-flash";

const provider = new GeminiProvider({
  baseUrl: "https://generativelanguage.googleapis.com",
  apiKey: key,
});

const tools = new ToolRegistry().getAll();
let text = "";
const calls: string[] = [];

for await (const evt of provider.stream({
  messages: [
    {
      id: "u",
      role: "user",
      content: "Read the file package.json and tell me only the package name.",
      timestamp: 0,
    },
  ],
  tools,
  model,
  systemPrompt: "You are a helpful coding agent. Use tools when needed.",
  temperature: 0.2,
})) {
  if (evt.type === "content") text += evt.content;
  else if (evt.type === "tool_call") calls.push(`${evt.toolCall.name}(${JSON.stringify(evt.toolCall.args)})`);
  else if (evt.type === "error") console.log("ERROR EVENT:", evt.error);
}

console.log("model:", model);
console.log("tool calls:", calls.length ? calls.join(", ") : "(none)");
console.log("text:", text.trim().slice(0, 200));
