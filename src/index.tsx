#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./ui/app.tsx";
import { FOCUS_REPORT_ON } from "./domain/attention.ts";
import { TERMINAL_RESET } from "./domain/terminal.ts";
import { markFocus } from "./domain/focus-state.ts";

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
// enabling earlier gets clobbered.
process.stdout.write(FOCUS_REPORT_ON);

// Track focus HERE, synchronously, rather than only in useAttention. The terminal fires a
// focus-in the instant the app launches (while it's focused), but useAttention subscribes
// from a React useEffect that runs after mount — too late to catch it. Missing that first
// event left the notifier "blind" (never saw a focus event), so it nudged even while the
// terminal was focused. Subscribing before render() catches the startup event; useAttention
// reads focusState for its decision. Both listeners coexist; this one owns the state.
renderer.on("focus", () => markFocus(true));
renderer.on("blur", () => markFocus(false));

// Hand the shell back clean on the way out. quit() (app.tsx) calls process.exit(0), which
// fires neither `beforeExit` nor a signal, so OpenTUI's own destroy()/teardown never runs —
// leaving mouse tracking, the alt-screen, focus reporting and bracketed paste enabled. The
// most visible fallout is scroll gibberish (raw mouse reports) after we exit. `exit` fires
// synchronously on process.exit, so a single write here restores every mode on every path.
process.on("exit", () => process.stdout.write(TERMINAL_RESET));

createRoot(renderer).render(<App />);
