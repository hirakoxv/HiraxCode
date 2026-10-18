#!/usr/bin/env bun
// Launcher for the published npm package.
// The CLI itself lives in ../src/index.tsx and needs Bun at runtime
// (Bun.spawn / Bun.which / Bun.serve / Bun.Glob), so keep this thin.
import "../src/index.tsx";
