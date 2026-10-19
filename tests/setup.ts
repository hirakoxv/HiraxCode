import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Runs before every test file (see bunfig.toml). Keeps tests isolated from the
 * real user config/session directories and from each other.
 */
const dir = mkdtempSync(join(tmpdir(), "hirax-test-"));

process.env.XDG_DATA_HOME = dir;
process.env.XDG_CONFIG_HOME = dir;
process.env.XDG_CACHE_HOME = dir;
process.env.WORKING_DIR = process.cwd();
process.env.DEBUG = "false";
// Never hit models.dev (or write its cache) during tests.
process.env.HIRAX_NO_REFRESH = "1";
// Tests must not spawn the Windows clipboard watcher (it is a long-lived
// background process that would keep the test runner alive).
process.env.HIRAX_NO_CLIPBOARD_WATCH = "1";

// Start from a clean slate — individual tests opt in to what they need.
for (const key of [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "MISTRAL_API_KEY",
  "XAI_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "CEREBRAS_API_KEY",
  "BASE_URL",
  "MODEL",
  "HIRAX_PROVIDER",
]) {
  delete process.env[key];
}
