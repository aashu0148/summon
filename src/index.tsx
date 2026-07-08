#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./ui/app.tsx";

const renderer = await createCliRenderer({
  // Grab the mouse so the wheel scrolls the conversation scrollbox. Without this
  // the terminal translates wheel events into arrow keys, which the input eats for
  // history recall. Trade-off: this captures drag, so the terminal's own selection +
  // Cmd/Ctrl-C won't work — instead drag to highlight (an in-app selection) and it's
  // copied the moment you release (copy-on-select, see app.tsx). Or hold Option
  // (macOS) / Shift to fall back to the terminal's native selection.
  useMouse: true,
});
createRoot(renderer).render(<App />);
