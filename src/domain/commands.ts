// Client-side slash commands. These never travel over the stream-json wire —
// Claude Code's own slash commands (/resume, /clear, ...) are a *client* feature,
// so if we forwarded "/resume" as a user message claude would just answer it in
// prose. We intercept a leading "/" in the input and act locally instead.

import { fmtTok, inTok } from "../lib/format.ts";

export type CommandCtx = {
  /** push a dim SYS line into the conversation */
  print: (text: string) => void;
  /** clear the on-screen conversation (does not touch the claude session) */
  clear: () => void;
  /** kill + respawn a fresh session, clearing context and the screen */
  newSession: () => void;
  /** resume a prior session by id, or continue the latest if no id given */
  resume: (id?: string) => void;
  /** switch model (re-spawns with --model, continuing context) */
  setModel: (alias: string) => void;
  /** switch color theme */
  setTheme: (name: string) => void;
  /** open an interactive picker overlay */
  openPicker: (kind: "resume" | "model" | "theme") => void;
  /** quit the app */
  quit: () => void;
  /** forward a synthesized prompt to claude; `display` overrides what shows in the transcript */
  sendPrompt: (text: string, display?: string) => void;
  /** current model string (already shortened) */
  model: () => string;
  /** current session id */
  session: () => string;
  /** cumulative token + cost totals for the current session */
  usage: () => { input: number; output: number; cacheRead: number; cacheCreate: number; costUsd: number };
  /** open the plan-usage overlay (fetches real subscription limits from Anthropic) */
  showUsage: () => void;
  /** fire a cheap Haiku one-shot answer (recent context only) and print it inline */
  quickAsk: (question: string) => void;
};

/** Render session usage totals as the multi-line body of the `/usage` output. Pure so it's testable. */
export function formatUsage(u: { input: number; output: number; cacheRead: number; cacheCreate: number; costUsd: number }): string {
  // "input" from the API is only the fresh, uncached tokens. During tool-use turns the
  // bulk of what's sent is replayed from the prompt cache, so break those out explicitly
  // rather than hiding them — otherwise the input line looks implausibly small.
  return [
    "usage this session:",
    `  input tokens    ${fmtTok(u.input)}`,
    `  cache read      ${fmtTok(u.cacheRead)}`,
    `  cache write     ${fmtTok(u.cacheCreate)}`,
    `  total input     ${fmtTok(inTok(u))}`,
    `  output tokens   ${fmtTok(u.output)}`,
    `  est. cost       ~$${u.costUsd.toFixed(4)}`,
  ].join("\n");
}

/** Where a mid-message command token sat: the text before and after it, in original order. */
export type CommandPos = { before: string; after: string };

export type Command = {
  name: string;
  aliases?: string[];
  description: string;
  run: (args: string, ctx: CommandCtx, pos?: CommandPos) => void;
};

export const COMMANDS: Command[] = [
  {
    name: "help",
    aliases: ["?"],
    description: "list commands and key bindings",
    run: (_args, ctx) => {
      const lines = [
        "commands:",
        ...COMMANDS.map((c) => {
          const names = [c.name, ...(c.aliases ?? [])].map((n) => "/" + n).join(", ");
          return `  ${names.padEnd(20)} ${c.description}`;
        }),
        "keys:",
        "  Ctrl+C               quit",
        "  Enter                send",
      ];
      ctx.print(lines.join("\n"));
    },
  },
  {
    name: "clear",
    description: "clear the screen (keeps the session context)",
    run: (_args, ctx) => ctx.clear(),
  },
  {
    name: "new",
    description: "start a fresh session (drops context)",
    run: (_args, ctx) => ctx.newSession(),
  },
  {
    name: "resume",
    description: "pick a past session to resume (or /resume <id>)",
    run: (args, ctx) => {
      const id = args.trim();
      if (id) ctx.resume(id);
      else ctx.openPicker("resume");
    },
  },
  {
    name: "model",
    description: "switch model via a picker (or /model <opus|sonnet|haiku>)",
    run: (args, ctx) => {
      const alias = args.trim();
      if (alias) ctx.setModel(alias);
      else ctx.openPicker("model");
    },
  },
  {
    name: "theme",
    description: "switch color theme via a picker (or /theme <name>)",
    run: (args, ctx) => {
      const name = args.trim();
      if (name) ctx.setTheme(name);
      else ctx.openPicker("theme");
    },
  },
  {
    name: "ask",
    description: "cheap Haiku answer using recent context",
    run: (args, ctx) => {
      const q = args.trim();
      if (!q) { ctx.print("usage: /ask <question>  ·  answers from Haiku using the last few turns"); return; }
      ctx.quickAsk(q);
    },
  },
  {
    name: "usage",
    description: "show your Claude plan usage (session + weekly limits)",
    run: (_args, ctx) => ctx.showUsage(),
  },
  {
    name: "cost",
    description: "show token usage and cost for this session",
    run: (_args, ctx) => ctx.print(formatUsage(ctx.usage())),
  },
  {
    name: "quit",
    aliases: ["exit", "q"],
    description: "quit summon",
    run: (_args, ctx) => ctx.quit(),
  },
];

// The `/token` the cursor is currently on: a slash on a start/whitespace boundary with
// no trailing space, anchored to the end of the draft. Mirrors MENTION_RE so commands
// autocomplete mid-message ("make a landing page /desi"), not just at the start. The
// boundary rule keeps URLs/paths ("http://x", "a/b") from being read as commands.
const SLASH_RE = /(?:^|\s)\/(\S*)$/;

/** The active slash-token being typed (without the "/"), or null if none. */
export function activeSlashToken(draft: string): string | null {
  return draft.match(SLASH_RE)?.[1] ?? null;
}

/**
 * Suggestions for the `/token` under the cursor. Returns [] when there's no active
 * slash-token or once it's "committed" — a space following the token drops the `$`
 * match, so the menu gets out of the way and the next Enter runs it (mirrors @-mentions).
 */
export function matchCommands(commands: Command[], draft: string, limit = 8): Command[] {
  const token = activeSlashToken(draft);
  if (token === null) return [];
  const tok = "/" + token;
  return commands.filter((c) => ("/" + c.name).startsWith(tok)).slice(0, limit);
}

/**
 * Complete the active `/token` (wherever it sits in the draft) to `/name`, keeping the
 * text before it intact and adding a trailing space so it's "committed" and the next
 * Enter runs it.
 */
export function completeCommand(draft: string, name: string): string {
  if (!SLASH_RE.test(draft)) return draft;
  return draft.replace(SLASH_RE, (m) => m.slice(0, m.indexOf("/")) + "/" + name + " ");
}

/**
 * Format a command for the `/`-hint menu: the `▸`/space marker + `/name`, and the
 * description (padded with two leading spaces, truncated to 60). Pure so the render
 * layer just paints the two segments in different colors.
 */
export function formatCommandHint(c: Command, selected: boolean): { label: string; desc: string } {
  return {
    label: (selected ? "▸ " : "  ") + "/" + c.name,
    desc: c.description ? "  " + c.description.slice(0, 60) : "",
  };
}

function indexByName(commands: Command[]): Map<string, Command> {
  const m = new Map<string, Command>();
  for (const c of commands) {
    m.set(c.name, c);
    for (const a of c.aliases ?? []) m.set(a, c);
  }
  return m;
}

/**
 * Find a KNOWN command token appearing mid-message (i.e. not at the very start).
 * A token is `/name` sitting on a whitespace/start boundary so we don't mistake
 * URLs or paths ("http://x", "a/b") for commands. Only tokens that resolve to a
 * real command match — unknown "/foo" mid-message is left alone as prose. The
 * remaining text (everything before and after the token) becomes the args, so
 * "make a landing page /design" runs /design with "make a landing page".
 * Exported for tests.
 */
export function findInlineCommand(
  input: string,
  index: Map<string, Command>,
): { cmd: Command; args: string; pos: CommandPos } | null {
  const re = /(^|\s)\/([A-Za-z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const name = (m[2] ?? "").toLowerCase();
    const cmd = index.get(name);
    if (!cmd) continue;
    const tokenStart = m.index + (m[1] ?? "").length; // position of "/"
    const tokenEnd = tokenStart + 1 + (m[2] ?? "").length;
    const before = input.slice(0, tokenStart).trim();
    const after = input.slice(tokenEnd).trim();
    const args = [before, after].filter(Boolean).join(" ");
    return { cmd, args, pos: { before, after } };
  }
  return null;
}

/**
 * If `input` is a slash command, run it and return true (do NOT forward to
 * claude verbatim). Otherwise return false. `commands` defaults to the built-in
 * set; callers pass built-ins + discovered skills so both are dispatchable.
 *
 * A leading "/token" is authoritative: an unknown one prints a local error. A
 * command appearing mid-message only fires if it's a KNOWN command (built-in or
 * discovered skill); the rest of the message becomes its args. Unknown slashes
 * mid-message are ordinary text and pass through to claude.
 */
export function dispatchCommand(input: string, ctx: CommandCtx, commands: Command[] = COMMANDS): boolean {
  const index = indexByName(commands);
  const trimmed = input.trim();
  if (trimmed.startsWith("/")) {
    const [rawName, ...rest] = trimmed.slice(1).split(/\s+/);
    const name = (rawName ?? "").toLowerCase();
    const cmd = index.get(name);
    if (!cmd) {
      ctx.print(`unknown command: /${name}  ·  try /help`);
      return true;
    }
    const args = rest.join(" ");
    cmd.run(args, ctx, { before: "", after: args });
    return true;
  }
  const inline = findInlineCommand(trimmed, index);
  if (!inline) return false;
  inline.cmd.run(inline.args, ctx, inline.pos);
  return true;
}
