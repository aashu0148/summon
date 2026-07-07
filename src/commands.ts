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

const byName = new Map<string, Command>();
for (const c of COMMANDS) {
  byName.set(c.name, c);
  for (const a of c.aliases ?? []) byName.set(a, c);
}

/**
 * If `input` is a slash command, run it and return true (do NOT forward to
 * claude). Otherwise return false. Unknown commands print a local error.
 */
export function dispatchCommand(input: string, ctx: CommandCtx): boolean {
  if (!input.startsWith("/")) return false;
  const [rawName, ...rest] = input.slice(1).trim().split(/\s+/);
  const name = (rawName ?? "").toLowerCase();
  const cmd = byName.get(name);
  if (!cmd) {
    ctx.print(`unknown command: /${name}  ·  try /help`);
    return true;
  }
  cmd.run(rest.join(" "), ctx);
  return true;
}
