import { homedir } from "node:os";
import { defaultTextareaKeyBindings } from "@opentui/core";
import type { Usage, AskQuestion } from "../session/claude-session.ts";
import type { Theme } from "./theme.ts";

export type Role = "you" | "claude" | "sys" | "err" | "file";
export type Turn = { role: Role; text: string };
export type Opt = { name: string; description: string; value: string };
export type Picker = { kind: "resume" | "model" | "theme"; title: string; options: Opt[] };
export type Ask = { requestId: string; questions: AskQuestion[] };

// Main input keybindings: Enter submits, Shift+Enter inserts a newline (default is the
// reverse). We start from the defaults so all editing keys keep working.
export const INPUT_KEYBINDINGS = [
  ...defaultTextareaKeyBindings.filter(
    (b) => !((b.name === "return" || b.name === "kpenter" || b.name === "linefeed") && b.action === "newline"),
  ),
  { name: "return", action: "submit" },
  { name: "kpenter", action: "submit" },
  { name: "return", shift: true, action: "newline" },
] as typeof defaultTextareaKeyBindings;

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Human-readable "what Claude is doing right now" label for a tool. Shown as an ephemeral
// status while a tool runs so the user isn't left staring at a bare "thinking…" during
// tool use (Read/Bash/Grep/… emit no delta or thinking text, only a `tool` event).
const TOOL_VERB: Record<string, string> = {
  Bash: "running a command",
  Read: "reading a file",
  Write: "writing a file",
  Edit: "editing a file",
  MultiEdit: "editing a file",
  NotebookEdit: "editing a notebook",
  Grep: "searching the code",
  Glob: "finding files",
  LS: "listing files",
  WebFetch: "fetching a page",
  WebSearch: "searching the web",
  Task: "running a subagent",
  TodoWrite: "planning",
};
export const toolActivity = (name: string) => TOOL_VERB[name] ?? `running ${name}`;

// Trailing @-mention token being typed, e.g. "look at @src/ap" → captures "src/ap".
export const MENTION_RE = /(?:^|\s)@([^\s]*)$/;

// Curated model list — the CLI does NOT broadcast its menu over stream-json (no
// `available_models` event fires), so we mirror Claude Code's picker by hand. Values
// are what get passed to set_model / --model; a bad value surfaces as an ERR line.
export const MODELS: Opt[] = [
  { name: "Default", description: "let claude choose (recommended)", value: "default" },
  { name: "Opus 4.8", description: "claude-opus-4-8 — most capable", value: "claude-opus-4-8" },
  { name: "Opus 4.8 (1M)", description: "claude-opus-4-8[1m] — 1M context", value: "claude-opus-4-8[1m]" },
  { name: "Sonnet 4.6", description: "claude-sonnet-4-6 — balanced", value: "claude-sonnet-4-6" },
  { name: "Sonnet 4.6 (1M)", description: "claude-sonnet-4-6[1m] — 1M context", value: "claude-sonnet-4-6[1m]" },
  { name: "Haiku 4.5", description: "claude-haiku-4-5 — fastest", value: "claude-haiku-4-5" },
  { name: "Fable 5", description: "claude-fable-5", value: "claude-fable-5" },
];

// Collapse consecutive same-role turns into one group so the transcript shows a single
// role label above a run of messages (e.g. five Claude replies in a row → one "CLAUDE"
// header, five stacked message bodies) instead of repeating the label before each.
export type TurnGroup = { role: Role; texts: string[] };
export function groupTurns(turns: Turn[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const turn of turns) {
    const last = groups[groups.length - 1];
    if (last && last.role === turn.role) last.texts.push(turn.text);
    else groups.push({ role: turn.role, texts: [turn.text] });
  }
  return groups;
}

export const LABEL_TEXT: Record<Role, string> = { you: "YOU", claude: "CLAUDE", sys: "SYS", err: "ERR", file: "EDIT" };
export const labelFg = (t: Theme, role: Role) =>
  role === "you" ? t.user : role === "claude" ? t.accent : role === "sys" ? t.sys : role === "file" ? t.ok : t.warn;
export const bodyFg = (t: Theme, role: Role) =>
  role === "claude" ? t.ink : role === "err" ? t.warn : role === "file" ? t.ok : t.muted;

export const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

// Fallback "chat name" for a brand-new, empty session — the app's own name.
export const PROJECT = "summon";

// Sentinel value for the always-appended "Other…" answer in an AskUserQuestion prompt.
export const OTHER = "__other__";

// The dir we're running claude in (fixed for the process). ~-relative, trailing-trimmed.
export const CWD = (() => {
  const home = homedir();
  let p = process.cwd();
  if (p === home) return "~";
  if (p.startsWith(home + "/")) p = "~" + p.slice(home.length);
  if (p.length > 30) p = "…/" + p.split("/").slice(-2).join("/");
  return p;
})();
