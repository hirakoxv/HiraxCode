import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

let cached: string | undefined;

/**
 * The version reported by package.json, found by walking up from this module. Works both
 * when running from source and from the bundled `dist/index.js`, so the UI never has to
 * hard-code a version that drifts from the published package.
 */
export function packageVersion(): string {
  if (cached !== undefined) return cached;

  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    cached = "0.0.0";
    return cached;
  }

  for (let i = 0; i < 5; i++) {
    const file = join(dir, "package.json");
    try {
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, "utf-8")) as { version?: unknown };
        if (typeof parsed.version === "string" && parsed.version) {
          cached = parsed.version;
          return cached;
        }
      }
    } catch {
      // unreadable or malformed package.json: keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  cached = "0.0.0";
  return cached;
}
