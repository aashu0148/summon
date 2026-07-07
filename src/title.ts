// Terminal window/icon title — what the tab shows in VS Code, iTerm, etc.
// Mirrors Claude Code: a filled dot while a turn is running, a glyph when idle,
// followed by the "chat name" (the first thing the user asked) so multiple open
// terminals are distinguishable at a glance. Pure string logic, wired in app.tsx.

export type TitleState = { busy: boolean; label: string };

const RUNNING = "●"; // a turn is in flight
const IDLE = "✳"; // idle — the claude glyph

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

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

// OSC 0 escape — sets both the window and icon title. Writing it to a TTY updates
// the terminal tab; on a non-TTY it's harmless bytes.
export const titleSequence = (title: string) => `\x1b]0;${title}\x07`;
