import { test, expect } from "bun:test";
import { relPath, fileTurnText, foldFileEdit, type FileEdit } from "../../src/domain/file-edits.ts";

test("relPath strips the cwd prefix, leaves outside paths absolute", () => {
  expect(relPath("/repo/src/foo.ts", "/repo")).toBe("src/foo.ts");
  expect(relPath("/other/bar.ts", "/repo")).toBe("/other/bar.ts");
  expect(relPath("/repo", "/repo")).toBe("/repo"); // exact cwd, no trailing slash
});

test("fileTurnText formats the counts", () => {
  expect(fileTurnText({ rel: "src/foo.ts", added: 12, removed: 3 })).toBe("✎ src/foo.ts  +12 −3");
});

test("foldFileEdit accumulates counts for the same file", () => {
  const prev: FileEdit = { rel: "src/foo.ts", added: 5, removed: 2 };
  const next: FileEdit = { rel: "src/foo.ts", added: 3, removed: 1 };
  expect(foldFileEdit(prev, next)).toEqual({ rel: "src/foo.ts", added: 8, removed: 3 });
});

test("foldFileEdit returns null for a different file", () => {
  const prev: FileEdit = { rel: "src/foo.ts", added: 5, removed: 2 };
  const next: FileEdit = { rel: "src/bar.ts", added: 3, removed: 1 };
  expect(foldFileEdit(prev, next)).toBeNull();
});

test("foldFileEdit returns null when there is no previous edit", () => {
  expect(foldFileEdit(undefined, { rel: "src/foo.ts", added: 1, removed: 0 })).toBeNull();
});

test("a run of same-file edits folds to one accumulating row", () => {
  const edits: FileEdit[] = [
    { rel: "src/foo.ts", added: 4, removed: 1 },
    { rel: "src/foo.ts", added: 2, removed: 0 },
    { rel: "src/foo.ts", added: 1, removed: 3 },
  ];
  let row: FileEdit | undefined;
  for (const e of edits) row = foldFileEdit(row, e) ?? e;
  expect(row).toEqual({ rel: "src/foo.ts", added: 7, removed: 4 });
});

test("a different file breaks the run into a new row", () => {
  const rows: FileEdit[] = [];
  for (const e of [
    { rel: "a.ts", added: 1, removed: 0 },
    { rel: "a.ts", added: 2, removed: 0 },
    { rel: "b.ts", added: 5, removed: 1 },
  ] as FileEdit[]) {
    const merged = foldFileEdit(rows[rows.length - 1], e);
    if (merged) rows[rows.length - 1] = merged;
    else rows.push(e);
  }
  expect(rows).toEqual([
    { rel: "a.ts", added: 3, removed: 0 },
    { rel: "b.ts", added: 5, removed: 1 },
  ]);
});
