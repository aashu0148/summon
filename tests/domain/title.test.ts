import { test, expect } from "bun:test";
import { buildTitle, titleLabel, titleSequence } from "../../src/domain/title.ts";

test("buildTitle shows a dot while busy, the glyph when idle", () => {
  expect(buildTitle({ busy: true, label: "fix the parser" })).toBe("● fix the parser");
  expect(buildTitle({ busy: false, label: "fix the parser" })).toBe("✳ fix the parser");
});

test("buildTitle uses a distinct attention icon per reason, over busy/idle", () => {
  expect(buildTitle({ busy: false, label: "fix the parser", attention: "done" })).toBe("✅ fix the parser");
  expect(buildTitle({ busy: true, label: "fix the parser", attention: "blocked" })).toBe("❓ fix the parser");
  // no attention ⇒ normal icons unchanged
  expect(buildTitle({ busy: true, label: "fix the parser", attention: null })).toBe("● fix the parser");
  expect(buildTitle({ busy: false, label: "fix the parser" })).toBe("✳ fix the parser");
});

test("buildTitle falls back to 'summon' for an empty label", () => {
  expect(buildTitle({ busy: false, label: "" })).toBe("✳ summon");
  expect(buildTitle({ busy: true, label: "   " })).toBe("● summon");
});

test("buildTitle collapses whitespace/newlines to a single line", () => {
  expect(buildTitle({ busy: false, label: "line one\nline two   three" })).toBe("✳ line one line two three");
});

test("titleLabel uses the first user message, collapsed to one line", () => {
  expect(titleLabel("  hello\n world ", "proj")).toBe("hello world");
});

test("titleLabel falls back to the project dir for an empty chat", () => {
  expect(titleLabel(undefined, "claude-tui-prototype")).toBe("claude-tui-prototype");
  expect(titleLabel("", "claude-tui-prototype")).toBe("claude-tui-prototype");
});

test("titleLabel truncates long messages with an ellipsis", () => {
  const long = "a".repeat(60);
  const out = titleLabel(long, "proj", 40);
  expect(out.length).toBe(40);
  expect(out.endsWith("…")).toBe(true);
});

test("titleSequence wraps the title in OSC 0 and OSC 2 escapes", () => {
  expect(titleSequence("● hi")).toBe("\x1b]0;● hi\x07\x1b]2;● hi\x07");
});
