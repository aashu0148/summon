import { test, expect } from "bun:test";
import { notifyCommand, editorAppBundle, openFolderCommand, resolveNotifyOpts, terminalNotifierHint } from "../../src/domain/notify.ts";

// End-to-end for a given environment: resolve options from env, then build the spawn command.
// Lets us assert the exact behavior for each terminal/platform without spawning or being on it.
const cmdFor = (input: Parameters<typeof resolveNotifyOpts>[0], title = "Summon", message = "done") =>
  notifyCommand(input.platform, title, message, resolveNotifyOpts(input));

const VSCODE_ASKPASS = "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/git/dist/askpass-main.js";
const CURSOR_ASKPASS = "/Applications/Cursor.app/Contents/Resources/app/out/askpass-main.js";

test("editorAppBundle extracts the .app bundle from the askpass env path", () => {
  expect(editorAppBundle("/Applications/Visual Studio Code.app/Contents/Resources/app/x.js"))
    .toBe("/Applications/Visual Studio Code.app");
  expect(editorAppBundle("/Applications/Cursor.app/Contents/Resources/y.js")).toBe("/Applications/Cursor.app");
});

test("editorAppBundle returns undefined when there's no host editor / no .app in the path", () => {
  expect(editorAppBundle(undefined)).toBeUndefined();
  expect(editorAppBundle("/usr/local/bin/whatever")).toBeUndefined();
});

test("openFolderCommand shell-quotes the app and folder (spaces/quotes safe)", () => {
  expect(openFolderCommand("/Applications/Visual Studio Code.app", "/Users/a/my proj"))
    .toBe("open -a '/Applications/Visual Studio Code.app' '/Users/a/my proj'");
  expect(openFolderCommand("/Applications/X.app", "/tmp/o'brien"))
    .toBe("open -a '/Applications/X.app' '/tmp/o'\\''brien'");
});

test("macOS with terminal-notifier + executeCommand focuses the exact window on click", () => {
  const c = notifyCommand("darwin", "Summon", "done", {
    hasTerminalNotifier: true,
    bundleId: "com.microsoft.VSCode",
    executeCommand: "open -a '/Applications/Visual Studio Code.app' '/repo'",
  })!;
  expect(c.cmd).toBe("terminal-notifier");
  expect(c.args).toEqual([
    "-title", "Summon", "-message", "done", "-sound", "Ping",
    "-execute", "open -a '/Applications/Visual Studio Code.app' '/repo'",
  ]);
  expect(c.args).not.toContain("-activate"); // execute takes precedence over app-level activate
});

test("macOS terminal-notifier without an execute command falls back to app-level -activate", () => {
  const c = notifyCommand("darwin", "Summon", "done", { hasTerminalNotifier: true, bundleId: "com.microsoft.VSCode" })!;
  expect(c.cmd).toBe("terminal-notifier");
  expect(c.args).toEqual(["-title", "Summon", "-message", "done", "-sound", "Ping", "-activate", "com.microsoft.VSCode"]);
});

test("macOS terminal-notifier with neither execute nor bundle omits both click flags", () => {
  const c = notifyCommand("darwin", "Summon", "done", { hasTerminalNotifier: true })!;
  expect(c.cmd).toBe("terminal-notifier");
  expect(c.args).not.toContain("-activate");
  expect(c.args).not.toContain("-execute");
});

test("macOS without terminal-notifier falls back to an osascript banner", () => {
  const c = notifyCommand("darwin", "Summon", "fix the parser — task finished", { bundleId: "com.microsoft.VSCode" })!;
  expect(c.cmd).toBe("osascript");
  expect(c.args[0]).toBe("-e");
  expect(c.args[1]).toContain('display notification "fix the parser — task finished"');
  expect(c.args[1]).toContain('with title "Summon"');
  expect(c.args[1]).toContain("sound name");
});

test("macOS osascript fallback escapes embedded quotes/backslashes so AppleScript can't break", () => {
  const c = notifyCommand("darwin", "Summon", 'say "hi"\\bye')!;
  expect(c.args[1]).toContain('\\"hi\\"');
  expect(c.args[1]).toContain("\\\\bye");
});

test("Linux uses notify-send with title and message as separate args", () => {
  const c = notifyCommand("linux", "Summon", "done")!;
  expect(c).toEqual({ cmd: "notify-send", args: ["Summon", "done"] });
});

test("Windows uses a PowerShell balloon tip", () => {
  const c = notifyCommand("win32", "Summon", "done")!;
  expect(c.cmd).toBe("powershell");
  expect(c.args).toContain("-NoProfile");
  expect(c.args.at(-1)).toContain("ShowBalloonTip");
});

test("unknown platform yields no command (best-effort, never throws)", () => {
  expect(notifyCommand("freebsd" as NodeJS.Platform, "Summon", "done")).toBeNull();
});

// --- terminal matrix: env → resolved options → spawn command ---------------------------------

test("matrix · VS Code + terminal-notifier → click focuses the exact project window", () => {
  const c = cmdFor({
    platform: "darwin",
    env: { VSCODE_GIT_ASKPASS_MAIN: VSCODE_ASKPASS, __CFBundleIdentifier: "com.microsoft.VSCode" },
    hasTerminalNotifier: true,
    cwd: "/Users/a/proj",
  })!;
  expect(c.cmd).toBe("terminal-notifier");
  expect(c.args.slice(-2)).toEqual(["-execute", "open -a '/Applications/Visual Studio Code.app' '/Users/a/proj'"]);
});

test("matrix · Cursor + terminal-notifier → targets Cursor.app, not VS Code", () => {
  const c = cmdFor({
    platform: "darwin",
    env: { VSCODE_GIT_ASKPASS_MAIN: CURSOR_ASKPASS, __CFBundleIdentifier: "com.todesktop.x" },
    hasTerminalNotifier: true,
    cwd: "/repo",
  })!;
  expect(c.args.at(-1)).toBe("open -a '/Applications/Cursor.app' '/repo'");
});

test("matrix · iTerm2 (non-editor) + terminal-notifier → app-level -activate, no exact window", () => {
  const c = cmdFor({
    platform: "darwin",
    env: { __CFBundleIdentifier: "com.googlecode.iterm2" }, // no askpass ⇒ not an editor
    hasTerminalNotifier: true,
    cwd: "/repo",
  })!;
  expect(c.args.slice(-2)).toEqual(["-activate", "com.googlecode.iterm2"]);
  expect(c.args).not.toContain("-execute");
});

test("matrix · Terminal.app without terminal-notifier → plain osascript banner (still notifies)", () => {
  const c = cmdFor({
    platform: "darwin",
    env: { __CFBundleIdentifier: "com.apple.Terminal" },
    hasTerminalNotifier: false,
    cwd: "/repo",
  })!;
  expect(c.cmd).toBe("osascript"); // no click-to-focus, but the banner still appears
});

test("matrix · Linux → notify-send regardless of editor env (no click targeting)", () => {
  const c = cmdFor({
    platform: "linux",
    env: { VSCODE_GIT_ASKPASS_MAIN: VSCODE_ASKPASS, __CFBundleIdentifier: "irrelevant" },
    hasTerminalNotifier: false,
    cwd: "/repo",
  })!;
  expect(c.cmd).toBe("notify-send");
});

test("matrix · Windows → PowerShell balloon regardless of env", () => {
  const c = cmdFor({
    platform: "win32",
    env: { VSCODE_GIT_ASKPASS_MAIN: VSCODE_ASKPASS },
    hasTerminalNotifier: false,
    cwd: "C:/repo",
  })!;
  expect(c.cmd).toBe("powershell");
});

test("resolveNotifyOpts: non-macOS carries no click options", () => {
  expect(resolveNotifyOpts({ platform: "linux", env: {}, hasTerminalNotifier: false, cwd: "/x" })).toEqual({});
});

test("terminalNotifierHint: shown only on macOS when terminal-notifier is missing", () => {
  expect(terminalNotifierHint("darwin", false)).toContain("terminal-notifier");
  expect(terminalNotifierHint("darwin", true)).toBeNull(); // already installed
  expect(terminalNotifierHint("linux", false)).toBeNull(); // not a macOS feature
  expect(terminalNotifierHint("win32", false)).toBeNull();
});
