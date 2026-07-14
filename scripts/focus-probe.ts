#!/usr/bin/env bun
// Live check that the terminal honors DECSET 1004 focus reporting — the one thing we can't
// verify headlessly. Run it, then click to another window and back a couple of times.
// If you see FOCUS-OUT / FOCUS-IN lines, your terminal reports focus and the attention
// feature's "only nudge when away" path works. If nothing prints on switch, the terminal
// can't report (e.g. macOS Terminal.app) and we fall back to always-notify. Ctrl-C to quit.
import { FOCUS_REPORT_ON, FOCUS_REPORT_OFF } from "../src/domain/attention.ts";

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write(FOCUS_REPORT_ON);
console.log("focus reporting ON — switch to another window and back. Ctrl-C to quit.\n");

const cleanup = () => { process.stdout.write(FOCUS_REPORT_OFF); process.stdin.setRawMode(false); process.exit(0); };

process.stdin.on("data", (buf) => {
  const s = buf.toString("binary");
  if (s.includes("\x03")) cleanup();                        // Ctrl-C
  else if (s === "\x1b[I") console.log("FOCUS-IN  ← terminal gained focus");
  else if (s === "\x1b[O") console.log("FOCUS-OUT → terminal lost focus");
  else console.log("other bytes:", JSON.stringify(s));
});
