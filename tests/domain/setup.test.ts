import { test, expect } from "bun:test";
import { setupPlan, type SetupStep } from "../../src/domain/setup.ts";

const runCmds = (steps: SetupStep[]) => steps.filter((s) => s.kind === "run").map((s) => (s as { cmd: string[] }).cmd.join(" "));
const kinds = (steps: SetupStep[]) => steps.map((s) => s.kind);

test("every platform installs deps and links the CLI first", () => {
  for (const p of ["darwin", "win32", "linux"] as NodeJS.Platform[]) {
    const cmds = runCmds(setupPlan(p, { hasBrew: false, hasTerminalNotifier: false }));
    expect(cmds.slice(0, 2)).toEqual(["bun install", "bun link"]);
  }
});

test("macOS without terminal-notifier but with brew installs it (optionally)", () => {
  const steps = setupPlan("darwin", { hasBrew: true, hasTerminalNotifier: false });
  const brew = steps.find((s) => s.kind === "run" && s.cmd[0] === "brew");
  expect(brew).toBeDefined();
  expect((brew as { cmd: string[] }).cmd).toEqual(["brew", "install", "terminal-notifier"]);
  expect((brew as { optional?: boolean }).optional).toBe(true); // must never abort setup
});

test("macOS with terminal-notifier already present skips the install", () => {
  const steps = setupPlan("darwin", { hasBrew: true, hasTerminalNotifier: true });
  expect(runCmds(steps)).toEqual(["bun install", "bun link"]);
  expect(kinds(steps)).toContain("info");
});

test("macOS without brew warns instead of installing (notifications still work)", () => {
  const steps = setupPlan("darwin", { hasBrew: false, hasTerminalNotifier: false });
  expect(runCmds(steps)).toEqual(["bun install", "bun link"]); // no brew step
  expect(kinds(steps)).toContain("warn");
});

test("Windows and Linux never touch terminal-notifier (macOS-only feature)", () => {
  for (const p of ["win32", "linux"] as NodeJS.Platform[]) {
    const steps = setupPlan(p, { hasBrew: true, hasTerminalNotifier: false });
    expect(runCmds(steps)).toEqual(["bun install", "bun link"]);
    expect(steps.some((s) => s.kind === "run" && s.cmd.includes("terminal-notifier"))).toBe(false);
  }
});
