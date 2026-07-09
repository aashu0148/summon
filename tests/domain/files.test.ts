import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitQueryDir, listProjectFiles, listFilesForQuery, matchFiles, fileListKey } from "../../src/domain/files.ts";

// Layout:  <tmp>/parent/{sibling/note.md, proj/{src/app.ts, readme.md}}
// cwd is <tmp>/parent/proj, so parent/sibling files are only reachable via "../".
let root: string; // parent
let cwd: string; // parent/proj

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "files-test-"));
  cwd = join(root, "proj");
  mkdirSync(join(cwd, "src"), { recursive: true });
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  mkdirSync(join(root, "sibling"), { recursive: true });
  writeFileSync(join(cwd, "src", "app.ts"), "");
  writeFileSync(join(cwd, "readme.md"), "");
  writeFileSync(join(cwd, ".claude", "config.md"), "");
  writeFileSync(join(root, "sibling", "note.md"), "");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

test("splitQueryDir separates the directory prefix from the fragment", () => {
  expect(splitQueryDir("app")).toEqual({ dir: "", frag: "app" });
  expect(splitQueryDir("src/ap")).toEqual({ dir: "src/", frag: "ap" });
  expect(splitQueryDir("../")).toEqual({ dir: "../", frag: "" });
  expect(splitQueryDir("../../src/ap")).toEqual({ dir: "../../src/", frag: "ap" });
});

test("listProjectFiles stays within the project root", () => {
  const files = listProjectFiles(cwd);
  expect(files.sort()).toEqual([join("src", "app.ts"), "readme.md"].sort());
});

test("listFilesForQuery without a dir prefix matches the cwd-rooted list", () => {
  expect(listFilesForQuery(cwd, "read").sort()).toEqual(listProjectFiles(cwd).sort());
});

test("listFilesForQuery surfaces parent-directory files, keeping the ../ prefix", () => {
  const files = listFilesForQuery(cwd, "../");
  expect(files).toContain("../sibling/note.md");
  expect(files).toContain("../proj/readme.md");
});

test("nested ../ climbs multiple levels and preserves the literal prefix", () => {
  const files = listFilesForQuery(cwd, "../sibling/no");
  expect(files).toContain("../sibling/note.md");
});

test("a parent-directory query completes to a valid ../ path", () => {
  const files = listFilesForQuery(cwd, "../sibling/no");
  expect(matchFiles(files, "../sibling/no")[0]).toBe("../sibling/note.md");
});

test("plain queries hide dot folders", () => {
  expect(listFilesForQuery(cwd, "read")).not.toContain(join(".claude", "config.md"));
});

test("a dot fragment surfaces hidden entries", () => {
  const files = listFilesForQuery(cwd, ".cla");
  expect(files).toContain(join(".claude", "config.md"));
});

test("a dot directory prefix browses inside the hidden folder", () => {
  const files = listFilesForQuery(cwd, ".claude/");
  expect(files).toContain(".claude/config.md");
});

test("fileListKey distinguishes hidden and non-hidden queries in the same dir", () => {
  // "@" and "@.cla" both walk "" but must not share a cached list, else the dot query
  // reuses the hidden-excluded list and never surfaces .claude.
  expect(fileListKey("")).not.toBe(fileListKey(".cla"));
  expect(fileListKey("read")).toBe(fileListKey("app")); // same dir, both non-hidden → shared
});
