import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TextareaRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { groupTurns, toolActivity, toolLine, INPUT_KEYBINDINGS } from "../../src/ui/constants.ts";

// Drive a REAL OpenTUI textarea (test renderer, no tty) with the raw byte sequences
// terminals emit, so the whole chain — stdin parse → keybinding map → action — is what's
// under test, not a re-implementation of it. Offline and deterministic.
describe("INPUT_KEYBINDINGS (Enter submits, Shift+Enter newlines)", () => {
  let renderer: any;
  let mockInput: any;
  let ta: TextareaRenderable;
  let submitted = 0;

  beforeAll(async () => {
    ({ renderer, mockInput } = await createTestRenderer({ width: 40, height: 10 }));
    ta = new TextareaRenderable(renderer, { id: "ta", keyBindings: INPUT_KEYBINDINGS, onSubmit: () => { submitted++; } });
    renderer.root.add(ta);
    ta.focus();
  });
  afterAll(() => renderer?.destroy());

  const reset = () => { ta.setText(""); submitted = 0; };

  test("plain Enter (CR) submits without inserting a newline", () => {
    reset();
    mockInput.pressKey("h");
    mockInput.pressKey("\r");
    expect(ta.plainText).toBe("h");
    expect(submitted).toBe(1);
  });

  test("Shift+Enter via the kitty keyboard protocol (Ghostty/kitty/WezTerm) inserts a newline", () => {
    reset();
    mockInput.pressKey("h");
    mockInput.pressKey("\x1b[13;2u"); // CSI 13;2u — kitty-encoded shift+return
    expect(ta.plainText).toBe("h\n");
    expect(submitted).toBe(0);
  });

  test("Shift+Enter as ESC CR (iTerm2 / VS Code / Cursor via Claude Code's /terminal-setup) inserts a newline — this was the regression: OpenTUI's default binds meta+return to submit", () => {
    reset();
    mockInput.pressKey("h");
    mockInput.pressKey("\x1b\r"); // ESC CR parses as meta+return
    expect(ta.plainText).toBe("h\n");
    expect(submitted).toBe(0);
  });

  test("Ctrl+J (linefeed) still inserts a newline", () => {
    reset();
    mockInput.pressKey("\n");
    expect(ta.plainText).toBe("\n");
    expect(submitted).toBe(0);
  });
});

describe("toolActivity", () => {
  test("falls back to the generic phrase with no target", () => {
    expect(toolActivity("Read")).toBe("reading a file");
    expect(toolActivity("Bash")).toBe("running a command");
  });
  test("swaps the noun for the concrete target", () => {
    expect(toolActivity("Read", "src/foo.ts")).toBe("reading src/foo.ts");
    expect(toolActivity("Bash", "npm test")).toBe("running npm test");
  });
  test("unknown tool uses 'running <name>'", () => {
    expect(toolActivity("Frobnicate")).toBe("running Frobnicate");
  });
});

describe("toolLine", () => {
  test("names the tool and its target", () => {
    expect(toolLine("Read", "src/foo.ts")).toBe("→ Read  src/foo.ts");
  });
  test("drops the target when empty", () => {
    expect(toolLine("TodoWrite", "")).toBe("→ TodoWrite");
  });
});

describe("groupTurns", () => {
  test("empty in, empty out", () => {
    expect(groupTurns([])).toEqual([]);
  });

  test("collapses consecutive same-role turns into one group", () => {
    const groups = groupTurns([
      { role: "claude", text: "a" },
      { role: "claude", text: "b" },
      { role: "claude", text: "c" },
    ]);
    expect(groups).toEqual([{ role: "claude", texts: ["a", "b", "c"] }]);
  });

  test("starts a new group when the role changes", () => {
    const groups = groupTurns([
      { role: "you", text: "hi" },
      { role: "claude", text: "1" },
      { role: "claude", text: "2" },
      { role: "you", text: "more" },
      { role: "claude", text: "3" },
    ]);
    expect(groups).toEqual([
      { role: "you", texts: ["hi"] },
      { role: "claude", texts: ["1", "2"] },
      { role: "you", texts: ["more"] },
      { role: "claude", texts: ["3"] },
    ]);
  });

  test("keeps distinct adjacent roles separate", () => {
    const groups = groupTurns([
      { role: "sys", text: "s" },
      { role: "err", text: "e" },
      { role: "file", text: "f" },
    ]);
    expect(groups.map((g) => g.role)).toEqual(["sys", "err", "file"]);
  });
});
