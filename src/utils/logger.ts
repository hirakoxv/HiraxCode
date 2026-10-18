import { appendFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const LOG_DIR =
  process.env.XDG_STATE_HOME || join(homedir(), ".local", "state", "hiraxcode");

let logFile = "";
try {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  logFile = join(LOG_DIR, "hiraxcode.log");
} catch {
  logFile = "";
}

const DEBUG = ["1", "true", "yes", "on"].includes(
  (process.env.DEBUG || "").toLowerCase(),
);

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level: string, args: unknown[]) {
  const line = `[${new Date().toISOString()}] [${level}] ${args
    .map(stringify)
    .join(" ")}\n`;

  try {
    if (logFile) appendFileSync(logFile, line);
  } catch {
    // never crash on logging
  }

  if (DEBUG && level !== "DEBUG") {
    process.stderr.write(line);
  }
}

export const logger = {
  /** Path to the current log file (empty when logging is unavailable). */
  get path(): string {
    return logFile;
  },
  debug: (...a: unknown[]) => write("DEBUG", a),
  info: (...a: unknown[]) => write("INFO", a),
  warn: (...a: unknown[]) => write("WARN", a),
  error: (...a: unknown[]) => write("ERROR", a),
};
