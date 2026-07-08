import { test, expect } from "bun:test";
import { relPath, fileTurnText, foldFileEdit, diffLineCounts, type FileEdit } from "../../src/domain/file-edits.ts";

test("relPath strips the cwd prefix, leaves outside paths absolute", () => {
  expect(relPath("/repo/src/foo.ts", "/repo")).toBe("src/foo.ts");
  expect(relPath("/other/bar.ts", "/repo")).toBe("/other/bar.ts");
  expect(relPath("/repo", "/repo")).toBe("/repo"); // exact cwd, no trailing slash
});

test("fileTurnText formats edit counts with both +/−", () => {
  expect(fileTurnText({ rel: "src/foo.ts", added: 12, removed: 3, kind: "edit" })).toBe("✎ src/foo.ts  +12 −3");
});

test("fileTurnText drops the removed count for a write (removals unknown)", () => {
  expect(fileTurnText({ rel: "src/foo.ts", added: 228, removed: 0, kind: "write" })).toBe("✎ src/foo.ts  +228");
});

test("diffLineCounts counts only changed lines, not shared context", () => {
  expect(diffLineCounts("a\nb\nc\nd\ne", "a\nb\nX\nd\ne")).toEqual({ added: 1, removed: 1 });
  expect(diffLineCounts("a\nb", "a\nb\nc")).toEqual({ added: 1, removed: 0 }); // pure insert
  expect(diffLineCounts("a\nb\nc", "a\nc")).toEqual({ added: 0, removed: 1 }); // pure delete
  expect(diffLineCounts("one\ntwo", "three\nfour")).toEqual({ added: 2, removed: 2 }); // full rewrite
  expect(diffLineCounts("", "a\nb\nc")).toEqual({ added: 3, removed: 0 }); // empty old
  expect(diffLineCounts("a\nb", "")).toEqual({ added: 0, removed: 2 }); // emptied out
});

test("foldFileEdit accumulates counts for the same file and kind", () => {
  const prev: FileEdit = { rel: "src/foo.ts", added: 5, removed: 2, kind: "edit" };
  const next: FileEdit = { rel: "src/foo.ts", added: 3, removed: 1, kind: "edit" };
  expect(foldFileEdit(prev, next)).toEqual({ rel: "src/foo.ts", added: 8, removed: 3, kind: "edit" });
});

test("foldFileEdit returns null for a different file", () => {
  const prev: FileEdit = { rel: "src/foo.ts", added: 5, removed: 2, kind: "edit" };
  const next: FileEdit = { rel: "src/bar.ts", added: 3, removed: 1, kind: "edit" };
  expect(foldFileEdit(prev, next)).toBeNull();
});

test("foldFileEdit returns null when the kind differs (write vs edit)", () => {
  const prev: FileEdit = { rel: "src/foo.ts", added: 5, removed: 0, kind: "write" };
  const next: FileEdit = { rel: "src/foo.ts", added: 3, removed: 1, kind: "edit" };
  expect(foldFileEdit(prev, next)).toBeNull();
});

test("foldFileEdit returns null when there is no previous edit", () => {
  expect(foldFileEdit(undefined, { rel: "src/foo.ts", added: 1, removed: 0, kind: "edit" })).toBeNull();
});

test("a run of same-file edits folds to one accumulating row", () => {
  const edits: FileEdit[] = [
    { rel: "src/foo.ts", added: 4, removed: 1, kind: "edit" },
    { rel: "src/foo.ts", added: 2, removed: 0, kind: "edit" },
    { rel: "src/foo.ts", added: 1, removed: 3, kind: "edit" },
  ];
  let row: FileEdit | undefined;
  for (const e of edits) row = foldFileEdit(row, e) ?? e;
  expect(row).toEqual({ rel: "src/foo.ts", added: 7, removed: 4, kind: "edit" });
});

test("a different file breaks the run into a new row", () => {
  const rows: FileEdit[] = [];
  for (const e of [
    { rel: "a.ts", added: 1, removed: 0, kind: "edit" },
    { rel: "a.ts", added: 2, removed: 0, kind: "edit" },
    { rel: "b.ts", added: 5, removed: 1, kind: "edit" },
  ] as FileEdit[]) {
    const merged = foldFileEdit(rows[rows.length - 1], e);
    if (merged) rows[rows.length - 1] = merged;
    else rows.push(e);
  }
  expect(rows).toEqual([
    { rel: "a.ts", added: 3, removed: 0, kind: "edit" },
    { rel: "b.ts", added: 5, removed: 1, kind: "edit" },
  ]);
});
