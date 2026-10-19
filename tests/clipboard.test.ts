import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expandImagePath, listImageFiles, fileName } from "@/utils/clipboard";
import { parseWatchLine } from "@/utils/clipboard-watch";

/** A throwaway folder with a few image-ish files. */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "hirax-clip-"));
  writeFileSync(join(dir, "shot-old.png"), "old");
  writeFileSync(join(dir, "shot-old.jpg"), "old");
  writeFileSync(join(dir, "notes.txt"), "not an image");
  writeFileSync(join(dir, "shot-new.png"), "new");
  // Pin timestamps so ordering is deterministic: `shot-new.png` first, then the
  // two old files tie-broken by name.
  const past = new Date(Date.now() - 60_000);
  utimesSync(join(dir, "shot-old.png"), past, past);
  utimesSync(join(dir, "shot-old.jpg"), past, past);
  const future = new Date(Date.now() + 60_000);
  utimesSync(join(dir, "shot-new.png"), future, future);
  return dir;
}

test("listImageFiles returns images newest first and skips other files", () => {
  const dir = fixture();
  const files = listImageFiles(dir).map(fileName);
  expect(files).toEqual(["shot-new.png", "shot-old.jpg", "shot-old.png"]);
});

test("listImageFiles honours the max cap", () => {
  const dir = fixture();
  expect(listImageFiles(dir, 2)).toHaveLength(2);
});

test("expandImagePath resolves a single file", () => {
  const dir = fixture();
  const found = expandImagePath(join(dir, "shot-old.jpg"));
  expect(found.map(fileName)).toEqual(["shot-old.jpg"]);
});

test("expandImagePath resolves a folder to its images", () => {
  const dir = fixture();
  const found = expandImagePath(dir).map(fileName);
  expect(found).toContain("shot-new.png");
  expect(found).not.toContain("notes.txt");
});

test("expandImagePath resolves a wildcard", () => {
  const dir = fixture();
  const found = expandImagePath(join(dir, "shot-old.*")).map(fileName).sort();
  expect(found).toEqual(["shot-old.jpg", "shot-old.png"]);
});

test("expandImagePath strips surrounding quotes", () => {
  const dir = fixture();
  const found = expandImagePath(`"${join(dir, "shot-new.png")}"`);
  expect(found.map(fileName)).toEqual(["shot-new.png"]);
});

test("expandImagePath ignores non-images and missing paths", () => {
  const dir = fixture();
  expect(expandImagePath(join(dir, "notes.txt"))).toEqual([]);
  expect(expandImagePath(join(dir, "nope.png"))).toEqual([]);
  expect(expandImagePath("")).toEqual([]);
});

test("expandImagePath resolves relative paths against cwd", () => {
  const dir = fixture();
  const found = expandImagePath("shot-new.png", dir);
  expect(found.map(fileName)).toEqual(["shot-new.png"]);
});

test("parseWatchLine accepts our IMG protocol", () => {
  const data = "A".repeat(120);
  expect(parseWatchLine(`IMG ${data}`)).toEqual({ mime: "image/png", data });
});

test("parseWatchLine rejects noise, truncation and junk", () => {
  expect(parseWatchLine("")).toBeNull();
  expect(parseWatchLine("hello")).toBeNull();
  expect(parseWatchLine("IMG short")).toBeNull();
  expect(parseWatchLine(`IMG ${"!".repeat(120)}`)).toBeNull();
  expect(parseWatchLine(`IMG ${"A".repeat(120)} trailing ${"B".repeat(10)}`)).toBeNull();
});
