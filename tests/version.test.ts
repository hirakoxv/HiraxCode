import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { packageVersion } from "@/core/version";

test("packageVersion reports the version from package.json", () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as {
    version: string;
  };
  expect(packageVersion()).toBe(pkg.version);
  expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
});
