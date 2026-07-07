// Client-side slash commands. These never travel over the stream-json wire —
// Claude Code's own slash commands (/resume, /clear, ...) are a *client* feature,
// so if we forwarded "/resume" as a user message claude would just answer it in
// prose. We intercept a leading "/" in the input and act locally instead.

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
};

export type Command = {
  name: string;
  aliases?: string[];
  description: string;
  run: (args: string, ctx: CommandCtx) => void;
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
    name: "quit",
    aliases: ["exit", "q"],
    description: "quit summon",
    run: (_args, ctx) => ctx.quit(),
  },
];

/**
 * Suggestions for a `/`-draft. Returns [] when there's no leading slash or once
 * the command is "committed" — i.e. a space already follows the token ("/name "),
 * meaning the user is typing args and the menu should get out of the way (this is
 * what lets a second Enter actually run it, mirroring the @-mention picker).
 */
export function matchCommands(commands: Command[], draft: string, limit = 8): Command[] {
  if (!draft.startsWith("/")) return [];
  if (/^\/\S+\s/.test(draft)) return []; // committed → no menu
  const tok = draft.split(/\s+/)[0] ?? "";
  return commands.filter((c) => ("/" + c.name).startsWith(tok)).slice(0, limit);
}

/**
 * Complete the leading `/token` of `draft` to `/name`, preserving any args after
 * the first space. When there are no args a trailing space is added so the token
 * is "committed" and the next Enter runs it.
 */
export function completeCommand(draft: string, name: string): string {
  const m = /^\/\S*(.*)$/.exec(draft);
  const rest = m?.[1] ?? "";
  return "/" + name + (rest.length ? rest : " ");
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
 * If `input` is a slash command, run it and return true (do NOT forward to
 * claude verbatim). Otherwise return false. `commands` defaults to the built-in
 * set; callers pass built-ins + discovered skills so both are dispatchable.
 * Unknown commands print a local error.
 */
export function dispatchCommand(input: string, ctx: CommandCtx, commands: Command[] = COMMANDS): boolean {
  if (!input.startsWith("/")) return false;
  const [rawName, ...rest] = input.slice(1).trim().split(/\s+/);
  const name = (rawName ?? "").toLowerCase();
  const cmd = indexByName(commands).get(name);
  if (!cmd) {
    ctx.print(`unknown command: /${name}  ·  try /help`);
    return true;
  }
  cmd.run(rest.join(" "), ctx);
  return true;
}
