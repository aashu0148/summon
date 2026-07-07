import { test, expect } from "bun:test";
import { buildTitlePrompt, sanitizeTitle } from "./title-gen.ts";

test("buildTitlePrompt includes the opening exchange and the word cap", () => {
  const p = buildTitlePrompt("help me fix the parser", "Sure, which parser?", 5);
  expect(p).toContain("at most 5 words");
  expect(p).toContain("User: help me fix the parser");
  expect(p).toContain("Assistant: Sure, which parser?");
});

test("buildTitlePrompt collapses whitespace and omits an empty assistant line", () => {
  const p = buildTitlePrompt("line one\n  line two", "");
  expect(p).toContain("User: line one line two");
  expect(p).not.toContain("Assistant:");
});

test("sanitizeTitle strips a Title: prefix, quotes, and trailing punctuation", () => {
  expect(sanitizeTitle('Title: "Fix the parser".')).toBe("Fix the parser");
  expect(sanitizeTitle("“Refactor queue drain”")).toBe("Refactor queue drain");
});

test("sanitizeTitle collapses whitespace and truncates with an ellipsis", () => {
  expect(sanitizeTitle("  wire   up\ntitles ")).toBe("wire up titles");
  const long = "a".repeat(60);
  const out = sanitizeTitle(long, 40);
  expect(out.length).toBe(40);
  expect(out.endsWith("…")).toBe(true);
});

test("sanitizeTitle returns empty when nothing usable remains", () => {
  expect(sanitizeTitle("   ")).toBe("");
  expect(sanitizeTitle('"".')).toBe("");
});
