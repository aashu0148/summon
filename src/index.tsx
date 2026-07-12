#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./ui/app.tsx";
import { FOCUS_REPORT_ON, FOCUS_REPORT_OFF } from "./domain/attention.ts";

const renderer = await createCliRenderer({
  // Grab the mouse so the wheel scrolls the conversation scrollbox. Without this
  // the terminal translates wheel events into arrow keys, which the input eats for
  // history recall. Trade-off: this captures drag, so the terminal's own selection +
  // Cmd/Ctrl-C won't work — instead drag to highlight (an in-app selection) and it's
  // copied the moment you release (copy-on-select, see app.tsx). Or hold Option
  // (macOS) / Shift to fall back to the terminal's native selection.
  useMouse: true,
});

// Turn on terminal focus reporting (DECSET 1004) so we can tell when the user switches away
// and only nudge them then — OpenTUI surfaces the terminal's focus-in/out as focus/blur
// events (see useAttention). The user configures nothing; we emit the escape, the terminal
// obliges. This MUST run after createCliRenderer: setupTerminal resets terminal modes, so
// enabling earlier gets clobbered. Restored on exit so the shell doesn't keep receiving
// focus escapes after we quit.
process.stdout.write(FOCUS_REPORT_ON);
process.on("exit", () => process.stdout.write(FOCUS_REPORT_OFF));

createRoot(renderer).render(<App />);
