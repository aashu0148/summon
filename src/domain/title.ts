// Terminal window/icon title — what the tab shows in VS Code, iTerm, etc.
// Mirrors Claude Code: a filled dot while a turn is running, a glyph when idle,
// followed by the "chat name" (the first thing the user asked) so multiple open
// terminals are distinguishable at a glance. Pure string logic, wired in app.tsx.

import { oneLine } from "../lib/format.ts";

export type TitleState = { busy: boolean; label: string };

const RUNNING = "●"; // a turn is in flight
const IDLE = "✳"; // idle — the claude glyph

// The full title string: "<icon> <name>", never empty.
export function buildTitle({ busy, label }: TitleState): string {
  const name = oneLine(label) || "summon";
  return `${busy ? RUNNING : IDLE} ${name}`;
}

// The conversation's name: the first user message, collapsed to one line and
// truncated. Falls back to `fallback` (e.g. the project dir) for an empty chat.
export function titleLabel(firstUserMessage: string | undefined, fallback: string, max = 40): string {
  const base = oneLine(firstUserMessage ?? "") || oneLine(fallback) || "summon";
  return base.length > max ? base.slice(0, max - 1) + "…" : base;
}

// OSC escapes that set the terminal title. Writing them to a TTY updates the tab;
// on a non-TTY they're harmless bytes.
//
// We emit OSC 0 (window + icon title) *and* OSC 2 (window title). Real terminals
// treat OSC 0 as enough, but VS Code's integrated terminal (xterm.js) only captures
// the sequence into its `${sequence}` variable — it shows in the tab only when
// `terminal.integrated.tabs.title` includes `${sequence}` (see README/settings).
// Emitting both maximizes the chance the host picks it up.
export const titleSequence = (title: string) => `\x1b]0;${title}\x07\x1b]2;${title}\x07`;
