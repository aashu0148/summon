#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./ui/app.tsx";

const renderer = await createCliRenderer({
  // Grab the mouse so the wheel scrolls the conversation scrollbox. Without this
  // the terminal translates wheel events into arrow keys, which the input eats for
  // history recall. Trade-off: this captures drag, so plain Cmd/Ctrl-C copy via the
  // terminal's own selection won't work — instead drag to highlight (an in-app
  // selection) and press Ctrl+C, which copies via OSC52 (see app.tsx). Or hold Option
  // (macOS) / Shift to fall back to the terminal's native selection.
  useMouse: true,
});
createRoot(renderer).render(<App />);
