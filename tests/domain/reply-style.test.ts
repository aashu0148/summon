import { test, expect, describe } from "bun:test";
import { INSTRUCTIONS, wrapPrompt, toggleStyle } from "../../src/domain/reply-style.ts";

describe("wrapPrompt", () => {
  test("returns the text unchanged when no style is active", () => {
    expect(wrapPrompt("hi", null)).toBe("hi");
  });

  test("appends the caveman instruction after the original text", () => {
    const wired = wrapPrompt("hi", "caveman");
    expect(wired.startsWith("hi\n\n")).toBe(true);
    expect(wired).toContain(INSTRUCTIONS.caveman);
  });

  test("appends the crossquestion instruction, not the caveman one", () => {
    const wired = wrapPrompt("hi", "crossquestion");
    expect(wired).toContain(INSTRUCTIONS.crossquestion);
    expect(wired).not.toContain("caveman-terse");
  });
});

describe("toggleStyle", () => {
  test("activates a style from off", () => {
    expect(toggleStyle(null, "caveman")).toBe("caveman");
  });

  test("requesting the active style turns it off", () => {
    expect(toggleStyle("caveman", "caveman")).toBe(null);
  });

  test("requesting the other style switches to it", () => {
    expect(toggleStyle("caveman", "crossquestion")).toBe("crossquestion");
  });
});
