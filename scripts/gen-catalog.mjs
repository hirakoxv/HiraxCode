#!/usr/bin/env bun
/**
 * Regenerate `src/core/models-dev.snapshot.json` from https://models.dev/api.json.
 *
 * The snapshot is bundled into the binary so HiraxCode knows every provider and
 * model (and their capabilities) even with no network. At runtime the catalog is
 * refreshed from the network and cached in ~/.cache/hiraxcode.
 *
 * Uses the same pipeline as the runtime (`buildCatalog`) so the bundled snapshot
 * and a live refresh can never diverge.
 *
 *   bun run scripts/gen-catalog.mjs
 */
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildCatalog } from "../src/core/catalog.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "core", "models-dev.snapshot.json");

const res = await fetch("https://models.dev/api.json");
if (!res.ok) {
  console.error(`models.dev returned ${res.status}`);
  process.exit(1);
}
const raw = await res.json();

const catalog = buildCatalog(raw);
if (!catalog) {
  console.error("buildCatalog produced no providers");
  process.exit(1);
}

const modelCount = Object.values(catalog.providers).reduce(
  (n, p) => n + Object.keys(p.models).length,
  0,
);

writeFileSync(OUT, JSON.stringify(catalog));
console.log(`providers: ${Object.keys(catalog.providers).length}  ·  models: ${modelCount}`);
console.log(`bytes: ${JSON.stringify(catalog).length}`);
console.log(`wrote ${OUT}`);
