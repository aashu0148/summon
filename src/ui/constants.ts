import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { defaultTextareaKeyBindings } from "@opentui/core";
import type { Usage, AskQuestion } from "../session/claude-session.ts";
import type { Theme } from "./theme.ts";
import type { FileEdit } from "../domain/file-edits.ts";

export type Role = "you" | "claude" | "ask" | "sys" | "err" | "file" | "write" | "tool" | "usage";
// `file` rows carry their accumulated edit so a following same-file edit can fold into
// them (see foldFileEdit) rather than re-parsing the counts back out of `text`.
export type Turn = { role: Role; text: string; file?: FileEdit };
export type Opt = { name: string; description: string; value: string };
export type Picker = { kind: "resume" | "model" | "theme"; title: string; options: Opt[] };
export type Ask = { requestId: string; questions: AskQuestion[] };

// Main input keybindings: Enter submits, Shift+Enter inserts a newline (default is the
// reverse). We start from the defaults so all editing keys keep working.
//
// Shift+Enter reaches us in TWO encodings depending on the terminal:
//  - kitty keyboard protocol (Ghostty, kitty, WezTerm): a real `return` + shift:true.
//  - ESC CR, i.e. meta+return (iTerm2 / VS Code / Cursor as configured by Claude Code's
//    /terminal-setup, and plain Option+Enter): OpenTUI's default binds meta+return to
//    SUBMIT, which made Shift+Enter send the message in those terminals. Override both
//    encodings to newline so Shift+Enter behaves the same everywhere.
export const INPUT_KEYBINDINGS = [
  ...defaultTextareaKeyBindings.filter(
    (b) => !((b.name === "return" || b.name === "kpenter" || b.name === "linefeed") && b.action === "newline"),
  ),
  { name: "return", action: "submit" },
  { name: "kpenter", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "return", meta: true, action: "newline" },
  { name: "kpenter", meta: true, action: "newline" },
] as typeof defaultTextareaKeyBindings;

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Human-readable "what Claude is doing right now" label for a tool. Shown as an ephemeral
// status while a tool runs so the user isn't left staring at a bare "thinking…" during
// tool use (Read/Bash/Grep/… emit no delta or thinking text, only a `tool` event). Each
// phrase leads with the present-participle verb, so toolActivity() can swap the generic
// noun ("a file") for the concrete target ("src/foo.ts") when we know it.
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

// Live status label, e.g. "reading src/foo.ts". With a target we keep just the verb and
// append it; without one we fall back to the full generic phrase ("reading a file").
export const toolActivity = (name: string, detail = "") => {
  const phrase = TOOL_VERB[name] ?? `running ${name}`;
  if (!detail) return phrase;
  const verb = phrase.split(" ")[0]; // "reading a file" → "reading"
  return `${verb} ${detail}`;
};

// Persistent transcript row for a tool call, e.g. "→ Read  src/foo.ts". Named after the
// actual tool (not the verb) so the trace reads like Claude Code's tool list.
export const toolLine = (name: string, detail: string) => (detail ? `→ ${name}  ${detail}` : `→ ${name}`);

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

export const LABEL_TEXT: Record<Role, string> = { you: "YOU", claude: "CLAUDE", ask: "ASK", sys: "SYS", err: "ERR", file: "EDIT", write: "WRITE", tool: "TOOL", usage: "⚠  USAGE LIMIT" };
export const labelFg = (t: Theme, role: Role) =>
  role === "you" ? t.user : role === "claude" ? t.accent : role === "ask" ? t.sys : role === "sys" ? t.sys : role === "file" || role === "write" ? t.ok : role === "tool" ? t.accentDim : t.warn;
export const bodyFg = (t: Theme, role: Role) =>
  role === "claude" || role === "ask" ? t.ink : role === "err" ? t.warn : role === "file" || role === "write" ? t.ok : role === "tool" ? t.accentDim : role === "usage" ? t.ink : t.muted;

export const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

// Fallback "chat name" for a brand-new, empty session — the app's own name.
export const PROJECT = "summon";

// Sentinel value for the always-appended "Other…" answer in an AskUserQuestion prompt.
// Defined in domain/ask.ts (the pure logic) and re-exported here for the UI layer.
export { OTHER } from "../domain/ask.ts";

// The dir we're running claude in (fixed for the process). ~-relative, trailing-trimmed.
export const CWD = (() => {
  const home = homedir();
  let p = process.cwd();
  if (p === home) return "~";
  if (p.startsWith(home + "/")) p = "~" + p.slice(home.length);
  if (p.length > 30) p = "…/" + p.split("/").slice(-2).join("/");
  return p;
})();

// Current git branch for the cwd (fixed for the process, "" if not a repo).
export const GIT_BRANCH = (() => {
  try {
    const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
    if (r.status !== 0) return "";
    const b = (r.stdout || "").trim();
    return b === "HEAD" ? "" : b;
  } catch {
    return "";
  }
})();
