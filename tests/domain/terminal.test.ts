import { test, expect } from "bun:test";
import { TERMINAL_RESET } from "../../src/domain/terminal.ts";

// The reset is what hands the shell back clean on exit. The regression it guards against is
// leaving mouse tracking on (scroll gibberish), so assert every mode we enable is turned off.
test("TERMINAL_RESET disables every terminal mode the TUI enables", () => {
  // mouse tracking, all encodings
  expect(TERMINAL_RESET).toContain("\x1b[?1000l");
  expect(TERMINAL_RESET).toContain("\x1b[?1002l");
  expect(TERMINAL_RESET).toContain("\x1b[?1003l");
  expect(TERMINAL_RESET).toContain("\x1b[?1006l");
  // focus reporting, bracketed paste, alternate screen
  expect(TERMINAL_RESET).toContain("\x1b[?1004l");
  expect(TERMINAL_RESET).toContain("\x1b[?2004l");
  expect(TERMINAL_RESET).toContain("\x1b[?1049l");
});

test("TERMINAL_RESET restores the cursor and color state last", () => {
  // Cursor must be visible and colors reset once modes are off, else the shell prompt can
  // land invisible or tinted by a leftover SGR.
  expect(TERMINAL_RESET).toContain("\x1b[?25h");
  expect(TERMINAL_RESET.endsWith("\x1b[0m")).toBe(true);
  // Every escape disables (…l) or restores state; nothing here should re-ENABLE a mode.
  expect(TERMINAL_RESET).not.toContain("\x1b[?1049h");
  expect(TERMINAL_RESET).not.toContain("\x1b[?1000h");
});
