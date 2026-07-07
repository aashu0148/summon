import { test, expect } from "bun:test";
import { markdownStyleSpec } from "../../src/ui/markdown-theme.ts";
import { amber, navy } from "../../src/ui/theme.ts";

test("maps core markdown scopes to theme colors", () => {
  const s = markdownStyleSpec(amber);
  expect(s.default).toEqual({ fg: amber.ink });
  expect(s["markup.heading"]).toEqual({ fg: amber.accent, bold: true });
  expect(s["markup.strong"]!.bold).toBe(true);
  expect(s["markup.italic"]!.italic).toBe(true);
  expect(s["markup.raw"]!.fg).toBe(amber.sys); // inline + fenced code
  expect(s["markup.link.label"]).toEqual({ fg: amber.user, underline: true });
});

test("re-tints with the active theme", () => {
  expect(markdownStyleSpec(navy).default!.fg).toBe(navy.ink);
  expect(markdownStyleSpec(navy)["markup.heading"]!.fg).toBe(navy.accent);
});

test("registers every scope the markdown renderer emits", () => {
  // These are the scope names MarkdownRenderable tags chunks with; a missing one would
  // silently fall back to "default" and lose its styling.
  const spec = markdownStyleSpec(amber);
  for (const scope of [
    "default",
    "markup.heading",
    "markup.strong",
    "markup.italic",
    "markup.strikethrough",
    "markup.raw",
    "markup.quote",
    "markup.list",
    "markup.link",
    "markup.link.label",
    "markup.link.url",
  ]) {
    expect(spec[scope]).toBeDefined();
  }
});
