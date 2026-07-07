import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { withTitle, loadTitles, saveTitle } from "../src/title-store.ts";

test("withTitle upserts and ignores empty id or title", () => {
  expect(withTitle({}, "s1", "Fix parser")).toEqual({ s1: "Fix parser" });
  expect(withTitle({ s1: "old" }, "s1", "new")).toEqual({ s1: "new" });
  expect(withTitle({ s1: "keep" }, "", "x")).toEqual({ s1: "keep" });
  expect(withTitle({ s1: "keep" }, "s2", "")).toEqual({ s1: "keep" });
});

test("saveTitle then loadTitles round-trips through a file", () => {
  const dir = mkdtempSync(join(tmpdir(), "summon-titles-"));
  const path = join(dir, "titles.json");
  try {
    expect(loadTitles(path)).toEqual({}); // missing file → empty
    saveTitle("abc", "Refactor queue", path);
    saveTitle("def", "Wire up resume titles", path);
    expect(loadTitles(path)).toEqual({ abc: "Refactor queue", def: "Wire up resume titles" });
    saveTitle("", "ignored", path); // empty id is a no-op
    expect(loadTitles(path)).toEqual({ abc: "Refactor queue", def: "Wire up resume titles" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadTitles tolerates garbage on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "summon-titles-"));
  const path = join(dir, "titles.json");
  try {
    writeFileSync(path, "[not an object]");
    expect(loadTitles(path)).toEqual({});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
