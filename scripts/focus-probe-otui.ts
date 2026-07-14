#!/usr/bin/env bun
// Second-stage focus probe: does OpenTUI (not just the raw terminal) deliver focus/blur to
// our app? focus-probe.ts proved the terminal EMITS the escapes; this proves whether the
// renderer we actually use SURFACES them as "focus"/"blur" events — the exact path
// useAttention subscribes to. Set up identically to index.tsx (createCliRenderer + useMouse
// + FOCUS_REPORT_ON). Events are logged to a FILE (not stdout — that would corrupt the TUI).
//
// Run it, switch to another window and back 2–3 times, then Ctrl-C. Then look at the log:
//   bun run scripts/focus-probe-otui.ts     # switch focus a few times, Ctrl-C
//   cat /tmp/otui-focus.log
// FOCUS/BLUR lines in the log ⇒ OpenTUI delivers focus events, so the app wiring works and
// the bug is elsewhere (the startup blind spot). No lines ⇒ OpenTUI is swallowing them.
import { createCliRenderer } from "@opentui/core";
import { appendFileSync, writeFileSync } from "node:fs";
import { FOCUS_REPORT_ON, FOCUS_REPORT_OFF } from "../src/domain/attention.ts";

const LOG = "/tmp/otui-focus.log";
writeFileSync(LOG, `probe started ${new Date().toISOString()}\n`);
const log = (m: string) => appendFileSync(LOG, `${new Date().toISOString()}  ${m}\n`);

const renderer = await createCliRenderer({ useMouse: true });
process.stdout.write(FOCUS_REPORT_ON);

renderer.on("focus", () => log("FOCUS  ← OpenTUI emitted focus"));
renderer.on("blur", () => log("BLUR   → OpenTUI emitted blur"));

log("listening — switch windows a few times, then Ctrl-C");

process.on("exit", () => process.stdout.write(FOCUS_REPORT_OFF));
