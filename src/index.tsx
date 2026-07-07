#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app.tsx";

const renderer = await createCliRenderer({
  // Don't grab the mouse: we have no mouse interactions, and capturing it
  // disables the terminal's native drag-to-select / Cmd-C. Off = copy works.
  useMouse: false,
});
createRoot(renderer).render(<App />);
