#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app.tsx";

const renderer = await createCliRenderer({
  // Grab the mouse so the wheel scrolls the conversation scrollbox. Without this
  // the terminal translates wheel events into arrow keys, which the input eats for
  // history recall. Trade-off: plain drag-to-select/Cmd-C is captured — hold Option
  // (macOS) or Shift to fall back to the terminal's native selection for copy.
  useMouse: true,
});
createRoot(renderer).render(<App />);
