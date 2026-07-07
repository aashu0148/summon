import { test, expect, describe } from "bun:test";
import {
  matchCommands,
  completeCommand,
  formatCommandHint,
  dispatchCommand,
  formatUsage,
  COMMANDS,
  type Command,
  type CommandCtx,
} from "../../src/domain/commands.ts";

// Minimal command set for deterministic matching tests (independent of the real
// built-ins, which may grow over time).
const CMDS: Command[] = [
  { name: "design", description: "d", run: () => {} },
  { name: "deep-research", description: "dr", run: () => {} },
  { name: "clear", description: "c", run: () => {} },
];

// A CommandCtx stub that records what each method was called with.
function stubCtx(): CommandCtx & { prints: string[]; prompts: { wire: string; display?: string }[]; usageOpens: number } {
  const prints: string[] = [];
  const prompts: { wire: string; display?: string }[] = [];
  const ctx = {
    prints,
    prompts,
    usageOpens: 0,
    print: (t: string) => prints.push(t),
    sendPrompt: (wire: string, display?: string) => prompts.push({ wire, display }),
    clear: () => {},
    newSession: () => {},
    resume: () => {},
    setModel: () => {},
    setTheme: () => {},
    openPicker: () => {},
    quit: () => {},
    model: () => "opus",
    session: () => "abcd",
    usage: () => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0, costUsd: 0 }),
    showUsage: () => { ctx.usageOpens++; },
  };
  return ctx;
}

describe("formatCommandHint", () => {
  test("marks the selected row with ▸ and pads the description", () => {
    expect(formatCommandHint(CMDS[0]!, true)).toEqual({ label: "▸ /design", desc: "  d" });
    expect(formatCommandHint(CMDS[0]!, false)).toEqual({ label: "  /design", desc: "  d" });
  });

  test("empty description → empty desc segment (no stray padding)", () => {
    expect(formatCommandHint({ name: "quit", description: "", run: () => {} }, false)).toEqual({
      label: "  /quit",
      desc: "",
    });
  });

  test("truncates long descriptions to 60 chars", () => {
    const long = "x".repeat(80);
    expect(formatCommandHint({ name: "z", description: long, run: () => {} }, false).desc).toBe(
      "  " + "x".repeat(60),
    );
  });
});

describe("matchCommands", () => {
  test("no leading slash → no hints", () => {
    expect(matchCommands(CMDS, "design")).toEqual([]);
    expect(matchCommands(CMDS, "")).toEqual([]);
  });

  test("prefix-matches on the /token", () => {
    expect(matchCommands(CMDS, "/de").map((c) => c.name)).toEqual(["design", "deep-research"]);
    expect(matchCommands(CMDS, "/c").map((c) => c.name)).toEqual(["clear"]);
    expect(matchCommands(CMDS, "/").map((c) => c.name)).toEqual(["design", "deep-research", "clear"]);
  });

  test("committed token (space after name) → no hints, so the next Enter runs it", () => {
    expect(matchCommands(CMDS, "/design ")).toEqual([]);
    expect(matchCommands(CMDS, "/design build a nav")).toEqual([]);
  });

  test("respects the limit", () => {
    expect(matchCommands(CMDS, "/", 2)).toHaveLength(2);
  });
});

describe("completeCommand", () => {
  test("completes a partial token and adds a trailing space when no args", () => {
    expect(completeCommand("/de", "design")).toBe("/design ");
  });

  test("preserves args after the first space", () => {
    expect(completeCommand("/de build a nav", "design")).toBe("/design build a nav");
  });

  test("re-completing an exact token is idempotent (adds the committing space)", () => {
    expect(completeCommand("/design", "design")).toBe("/design ");
  });
});

describe("formatUsage", () => {
  test("renders totals with compact tokens and 4-decimal cost", () => {
    const out = formatUsage({ input: 12300, output: 950, cacheRead: 0, cacheCreate: 0, costUsd: 0.1234 });
    expect(out).toContain("input tokens    12.3k");
    expect(out).toContain("output tokens   950");
    expect(out).toContain("est. cost       ~$0.1234");
  });

  test("breaks out cache tokens and a true total-input line", () => {
    const out = formatUsage({ input: 900, output: 5000, cacheRead: 340000, cacheCreate: 8000, costUsd: 0.5 });
    expect(out).toContain("cache read      340k");
    expect(out).toContain("cache write     8.0k");
    expect(out).toContain("total input     349k"); // 900 + 340000 + 8000 = 348900 -> 349k
  });
});

describe("/usage command", () => {
  test("opens the plan-usage overlay via ctx.showUsage() (no session-token print)", () => {
    const ctx = stubCtx();
    expect(dispatchCommand("/usage", ctx, COMMANDS)).toBe(true);
    expect(ctx.usageOpens).toBe(1);
    expect(ctx.prints).toEqual([]);
  });

  test("/cost prints the session token + cost totals", () => {
    const ctx = stubCtx();
    ctx.usage = () => ({ input: 2000, output: 500, cacheRead: 0, cacheCreate: 0, costUsd: 0.05 });
    expect(dispatchCommand("/cost", ctx, COMMANDS)).toBe(true);
    expect(ctx.prints[0]).toContain("usage this session:");
    expect(ctx.prints[0]).toContain("2.0k");
  });
});

describe("dispatchCommand", () => {
  test("non-slash input is not a command", () => {
    const ctx = stubCtx();
    expect(dispatchCommand("hello", ctx, CMDS)).toBe(false);
  });

  test("runs a matching command and reports handled", () => {
    let ran = "";
    const cmds: Command[] = [{ name: "echo", description: "", run: (args) => { ran = args; } }];
    const ctx = stubCtx();
    expect(dispatchCommand("/echo hi there", ctx, cmds)).toBe(true);
    expect(ran).toBe("hi there");
  });

  test("unknown command is handled locally with an error print", () => {
    const ctx = stubCtx();
    expect(dispatchCommand("/nope", ctx, CMDS)).toBe(true);
    expect(ctx.prints[0]).toContain("unknown command");
  });

  test("dispatch is case-insensitive on the name", () => {
    let ran = false;
    const cmds: Command[] = [{ name: "clear", description: "", run: () => { ran = true; } }];
    const ctx = stubCtx();
    dispatchCommand("/CLEAR", ctx, cmds);
    expect(ran).toBe(true);
  });

  test("a known command mid-message fires with the rest as args", () => {
    let ran: string | null = null;
    const cmds: Command[] = [{ name: "design", description: "", run: (args) => { ran = args; } }];
    const ctx = stubCtx();
    expect(dispatchCommand("make me a landing page /design", ctx, cmds)).toBe(true);
    expect(ran).toBe("make me a landing page");
  });

  test("args before and after a mid-message command are joined", () => {
    let ran: string | null = null;
    const cmds: Command[] = [{ name: "design", description: "", run: (args) => { ran = args; } }];
    const ctx = stubCtx();
    dispatchCommand("build /design a dark theme", ctx, cmds);
    expect(ran).toBe("build a dark theme");
  });

  test("an unknown slash mid-message is left as prose (not intercepted)", () => {
    const ctx = stubCtx();
    expect(dispatchCommand("see http://example.com/design for ideas", ctx, CMDS)).toBe(false);
    expect(ctx.prints.length).toBe(0);
  });

  test("a URL path is not mistaken for a command (needs a boundary)", () => {
    const ctx = stubCtx();
    // "/design" here sits inside a path, preceded by a letter not whitespace → no match.
    expect(dispatchCommand("open src/ui/design in the editor", ctx, CMDS)).toBe(false);
  });
});
