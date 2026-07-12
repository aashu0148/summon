// Attention-seeking: nudge the user when a turn finishes or blocks on input while they're
// looking at another window. People kick off a turn and go do other work in parallel, then
// forget the session is waiting on them. Pure escape sequences + the notify decision live
// here (and are unit-tested); the focus tracking + grace timing glue is in
// ui/hooks/useAttention.ts.

export type AttentionReason = "blocked" | "done";

// Terminal focus reporting (DECSET 1004). We write ON at startup so the terminal starts
// sending focus-in (`\x1b[I`) / focus-out (`\x1b[O`); OpenTUI's renderer turns those into
// "focus"/"blur" events. OFF on exit so the shell isn't left receiving focus escapes.
// No user setup — our app emits these; the terminal does the rest. Works in standalone
// terminals (iTerm2, kitty, WezTerm, Alacritty) and IDE terminals (VS Code/Cursor use
// xterm.js, which supports it). macOS Terminal.app ignores it — handled by shouldNotify.
export const FOCUS_REPORT_ON = "\x1b[?1004h";
export const FOCUS_REPORT_OFF = "\x1b[?1004l";

const BELL = "\x07";

// A desktop notification via OSC 9 — iTerm2 and kitty raise a native toast; other terminals
// treat it as inert bytes. Paired with the bell, which EVERY terminal honors: standalone
// terminals bounce the Dock / flash, IDE terminals flash the terminal tab.
export const osc9 = (msg: string) => `\x1b]9;${msg}\x07`;

// What we write to grab attention: bell (universal) + OSC 9 toast (where understood).
export const attentionSequence = (msg: string) => BELL + osc9(msg);

// The notification text. Leads with the state so a glance at the banner says what's needed:
// "Action required — <chat>" when Claude is blocked on the user, "Done — <chat>" when a turn
// finished.
export function attentionMessage(reason: AttentionReason, label: string): string {
  const name = label || "summon";
  return reason === "blocked" ? `Action required — ${name}` : `Done — ${name}`;
}

// Whether to actually nudge. If focus reporting never fired a single event we can't know
// where the user is (e.g. macOS Terminal.app doesn't support it), so err toward notifying —
// better a stray beep than a session waiting silently. When it IS live, only nudge while
// the terminal is unfocused, so we never nag a user who's already watching.
export function shouldNotify(focused: boolean, focusReportingLive: boolean): boolean {
  if (!focusReportingLive) return true;
  return !focused;
}
