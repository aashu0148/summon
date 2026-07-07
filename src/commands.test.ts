import { test, expect, describe } from "bun:test";
import {
  matchCommands,
  completeCommand,
  dispatchCommand,
  type Command,
  type CommandCtx,
} from "./commands.ts";

// Minimal command set for deterministic matching tests (independent of the real
// built-ins, which may grow over time).
const CMDS: Command[] = [
  { name: "design", description: "d", run: () => {} },
  { name: "deep-research", description: "dr", run: () => {} },
  { name: "clear", description: "c", run: () => {} },
];

// A CommandCtx stub that records what each method was called with.
function stubCtx(): CommandCtx & { prints: string[]; prompts: { wire: string; display?: string }[] } {
  const prints: string[] = [];
  const prompts: { wire: string; display?: string }[] = [];
  return {
    prints,
    prompts,
    print: (t) => prints.push(t),
    sendPrompt: (wire, display) => prompts.push({ wire, display }),
    clear: () => {},
    newSession: () => {},
    resume: () => {},
    setModel: () => {},
    setTheme: () => {},
    openPicker: () => {},
    quit: () => {},
    model: () => "opus",
    session: () => "abcd",
  };
}

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
});
