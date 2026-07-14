// Full terminal-mode reset, written once on exit. The TUI turns on several terminal modes
// while running — the alternate screen, mouse tracking, bracketed paste, focus reporting —
// via OpenTUI's native setup plus our own focus escape (see attention.ts). If the process
// exits without OpenTUI's destroy() running (e.g. an explicit process.exit, which fires
// neither `beforeExit` nor a signal handler), those modes are left ENABLED in the user's
// shell. The most visible symptom: mouse tracking stays on, so scrolling the terminal after
// we quit spews raw SGR mouse reports ("\x1b[<0;12;7M" …) as gibberish. Writing this reset
// on `process.on("exit")` guarantees the shell is handed back clean regardless of exit path.
//
// Pure string so it can be asserted in a unit test; the side-effecting write lives at the
// call site (index.tsx). Order: turn every mode OFF, then show the cursor and reset colors.
export const TERMINAL_RESET =
  "\x1b[?1000l" + // disable X10 mouse reporting
  "\x1b[?1002l" + // disable button-event mouse tracking
  "\x1b[?1003l" + // disable any-motion mouse tracking
  "\x1b[?1006l" + // disable SGR mouse encoding
  "\x1b[?1004l" + // disable focus reporting (DECSET 1004)
  "\x1b[?2004l" + // disable bracketed paste
  "\x1b[?1049l" + // leave the alternate screen buffer
  "\x1b[?25h" +   // show the cursor
  "\x1b[0m";      // reset colors / attributes
