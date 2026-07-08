import { test, expect } from "bun:test";
import { wrapText, scrollOffsetFor } from "../../src/ui/wrap.ts";

test("wraps on word boundaries within width", () => {
  expect(wrapText("the quick brown fox", 9)).toEqual(["the quick", "brown fox"]);
});

test("returns empty array for empty/whitespace text", () => {
  expect(wrapText("", 10)).toEqual([]);
  expect(wrapText("   ", 10)).toEqual([]);
});

test("collapses runs of whitespace", () => {
  expect(wrapText("a   b", 10)).toEqual(["a b"]);
});

test("hard-splits a word longer than the width", () => {
  expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
});

test("flushes the current line before hard-splitting a long word", () => {
  expect(wrapText("hi abcdefgh", 4)).toEqual(["hi", "abcd", "efgh"]);
});

test("does not clip: no wrapped line exceeds the width", () => {
  const text = "When you say a part can be on 5 active change orders at once, what's the real scenario?";
  for (const line of wrapText(text, 20)) expect(line.length).toBeLessThanOrEqual(20);
});

test("non-positive width falls back to a single line", () => {
  expect(wrapText("hello world", 0)).toEqual(["hello world"]);
  expect(wrapText("", 0)).toEqual([]);
});

test("scroll: keeps offset at 0 when everything fits", () => {
  expect(scrollOffsetFor([3, 3, 3], 2, 100, 0)).toBe(0);
});

test("scroll: advances offset so the selected item fits", () => {
  // three items of height 3, only 6 rows visible → selecting item 2 needs offset 1
  expect(scrollOffsetFor([3, 3, 3], 2, 6, 0)).toBe(1);
});

test("scroll: snaps back up when selection moves above the offset", () => {
  expect(scrollOffsetFor([3, 3, 3], 0, 6, 2)).toBe(0);
});

test("scroll: empty list returns 0", () => {
  expect(scrollOffsetFor([], 0, 10, 0)).toBe(0);
});

test("scroll: clamps an out-of-range previous offset", () => {
  expect(scrollOffsetFor([2, 2], 0, 10, 9)).toBe(0);
});
