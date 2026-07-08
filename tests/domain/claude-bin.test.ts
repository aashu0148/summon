import { test, expect } from "bun:test";
import {
  claudeCandidates,
  needsShell,
  resolveClaudeLaunchWith,
  type ResolveDeps,
} from "../../src/domain/claude-bin.ts";

const unix = (over: Partial<ResolveDeps> = {}): ResolveDeps => ({
  platform: "linux",
  env: { PATH: "/usr/bin:/usr/local/bin" },
  home: "/home/me",
  canRun: () => false,
  ...over,
});

const win = (over: Partial<ResolveDeps> = {}): ResolveDeps => ({
  platform: "win32",
  env: { Path: "C:\\Windows;C:\\tools", APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
  home: "C:\\Users\\me",
  canRun: () => false,
  ...over,
});

test("needsShell only flags Windows shim extensions", () => {
  expect(needsShell("C:\\x\\claude.cmd", "win32")).toBe(true);
  expect(needsShell("C:\\x\\claude.ps1", "win32")).toBe(true);
  expect(needsShell("C:\\x\\claude.bat", "win32")).toBe(true);
  expect(needsShell("C:\\x\\claude.exe", "win32")).toBe(false);
  // a .cmd on unix is just a filename, not a shim
  expect(needsShell("/x/claude.cmd", "linux")).toBe(false);
});

test("unix candidates cover PATH dirs plus well-known install locations", () => {
  const c = claudeCandidates(unix());
  expect(c).toContain("/usr/bin/claude");
  expect(c).toContain("/usr/local/bin/claude");
  expect(c).toContain("/home/me/.claude/local/claude"); // native installer
  expect(c).toContain("/opt/homebrew/bin/claude");
  expect(c).toContain("/home/me/.bun/bin/claude");
});

test("windows candidates expand PATHEXT-style extensions and npm dir", () => {
  const c = claudeCandidates(win());
  expect(c).toContain("C:\\Windows\\claude.cmd");
  expect(c).toContain("C:\\tools\\claude.exe");
  expect(c).toContain("C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd");
});

test("explicit override wins and is probed first", () => {
  const deps = unix({ env: { PATH: "/usr/bin", SUMMON_CLAUDE_BIN: "/custom/claude" } });
  expect(claudeCandidates(deps)[0]).toBe("/custom/claude");
  const launch = resolveClaudeLaunchWith({ ...deps, canRun: (p) => p === "/custom/claude" });
  expect(launch.command).toBe("/custom/claude");
  expect(launch.shell).toBe(false);
});

test("CLAUDE_BIN also honored as override", () => {
  const deps = unix({ env: { PATH: "/usr/bin", CLAUDE_BIN: "/alt/claude" } });
  expect(claudeCandidates(deps)[0]).toBe("/alt/claude");
});

test("resolves the first runnable candidate on unix", () => {
  const launch = resolveClaudeLaunchWith(unix({ canRun: (p) => p === "/usr/local/bin/claude" }));
  expect(launch.command).toBe("/usr/local/bin/claude");
  expect(launch.shell).toBe(false);
});

test("resolves a windows .cmd shim and flags it needs a shell", () => {
  const launch = resolveClaudeLaunchWith(win({ canRun: (p) => p === "C:\\tools\\claude.cmd" }));
  expect(launch.command).toBe("C:\\tools\\claude.cmd");
  expect(launch.shell).toBe(true);
});

test("unix fallback is a bare name with no shell when nothing is found", () => {
  const launch = resolveClaudeLaunchWith(unix());
  expect(launch).toEqual({ command: "claude", shell: false });
});

test("windows fallback uses a shell so cmd.exe applies PATHEXT", () => {
  const launch = resolveClaudeLaunchWith(win());
  expect(launch).toEqual({ command: "claude", shell: true });
});
