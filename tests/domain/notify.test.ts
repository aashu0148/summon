import { test, expect } from "bun:test";
import { notifyCommand, editorAppBundle, editorCliCandidates, editorDataDirName, focusFolder, openFolderCommand, parseOpenFolders, pickWorkspaceFolder, resolveNotifyOpts, terminalNotifierHint, uriToPath } from "../../src/domain/notify.ts";

// End-to-end for a given environment: resolve options from env, then build the spawn command.
// Lets us assert the exact behavior for each terminal/platform without spawning or being on it.
const cmdFor = (input: Parameters<typeof resolveNotifyOpts>[0], title = "Summon", message = "done") =>
  notifyCommand(input.platform, title, message, resolveNotifyOpts(input));

const VSCODE_ASKPASS = "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/git/dist/askpass-main.js";
const CURSOR_ASKPASS = "/Applications/Cursor.app/Contents/Resources/app/out/askpass-main.js";
const VSCODE_CLI = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
const CURSOR_CLI = "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";

test("editorAppBundle extracts the .app bundle from the askpass env path", () => {
  expect(editorAppBundle("/Applications/Visual Studio Code.app/Contents/Resources/app/x.js"))
    .toBe("/Applications/Visual Studio Code.app");
  expect(editorAppBundle("/Applications/Cursor.app/Contents/Resources/y.js")).toBe("/Applications/Cursor.app");
});

test("editorAppBundle returns undefined when there's no host editor / no .app in the path", () => {
  expect(editorAppBundle(undefined)).toBeUndefined();
  expect(editorAppBundle("/usr/local/bin/whatever")).toBeUndefined();
});

test("uriToPath decodes file:// URIs and passes plain paths through", () => {
  expect(uriToPath("file:///Users/a/my%20proj")).toBe("/Users/a/my proj");
  expect(uriToPath("/plain/path")).toBe("/plain/path");
  expect(uriToPath(undefined)).toBeUndefined();
});

test("parseOpenFolders extracts open-window folder paths from storage.json", () => {
  const json = JSON.stringify({
    windowsState: {
      lastActiveWindow: { folder: "file:///Users/a/work/superDM/full-stack" },
      openedWindows: [{ folder: "file:///Users/a/work/carbon" }, { folder: "file:///Users/a/work/claude-tui-prototype" }, { /* untitled window, no folder */ }],
    },
  });
  expect(parseOpenFolders(json)).toEqual([
    "/Users/a/work/carbon",
    "/Users/a/work/claude-tui-prototype",
    "/Users/a/work/superDM/full-stack",
  ]);
  expect(parseOpenFolders("not json")).toEqual([]); // never throws
});

test("pickWorkspaceFolder returns the deepest open folder that contains cwd", () => {
  const open = ["/Users/a/work", "/Users/a/work/superDM/full-stack", "/Users/a/work/carbon"];
  // cwd sits inside full-stack (a subfolder opened as its own workspace) → pick full-stack,
  // NOT the git root /Users/a/work/superDM which isn't open and would spawn a new window.
  expect(pickWorkspaceFolder("/Users/a/work/superDM/full-stack/src/api", open)).toBe("/Users/a/work/superDM/full-stack");
  // deepest wins even when an ancestor is also open
  expect(pickWorkspaceFolder("/Users/a/work/carbon/pkg", open)).toBe("/Users/a/work/carbon");
  // not a false-positive prefix match ("/work/carbon-x" isn't inside "/work/carbon")
  expect(pickWorkspaceFolder("/Users/a/work/carbon-extra/x", open)).toBe("/Users/a/work");
  // nothing open contains it
  expect(pickWorkspaceFolder("/tmp/elsewhere", open)).toBeUndefined();
});

test("focusFolder: open workspace wins; then git root; then cwd", () => {
  const open = ["/repo-open"];
  expect(focusFolder("/repo-open/sub/dir", open, "/some/gitroot")).toBe("/repo-open"); // exact open window
  expect(focusFolder("/other/deep/dir", [], "/other")).toBe("/other"); // no open match → git root
  expect(focusFolder("/other/deep/dir", [], undefined)).toBe("/other/deep/dir"); // no git → cwd
});

test("editorDataDirName maps VS Code's bundle to its data dir; others pass through", () => {
  expect(editorDataDirName("/Applications/Visual Studio Code.app")).toBe("Code");
  expect(editorDataDirName("/Applications/Visual Studio Code - Insiders.app")).toBe("Code - Insiders");
  expect(editorDataDirName("/Applications/Cursor.app")).toBe("Cursor");
  expect(editorDataDirName("/Applications/Windsurf.app")).toBe("Windsurf");
});

test("editorCliCandidates probes the bundle's own bin dir (best-first)", () => {
  const cands = editorCliCandidates("/Applications/Visual Studio Code.app");
  expect(cands[0]).toBe("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code");
  expect(cands).toContain("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/cursor");
});

test("openFolderCommand runs the editor CLI on the folder, shell-quoted (spaces/quotes safe)", () => {
  expect(openFolderCommand(VSCODE_CLI, "/Users/a/my proj"))
    .toBe(`'${VSCODE_CLI}' '/Users/a/my proj'`);
  expect(openFolderCommand("/apps/x/bin/code", "/tmp/o'brien"))
    .toBe("'/apps/x/bin/code' '/tmp/o'\\''brien'");
});

test("macOS with terminal-notifier + executeCommand focuses the exact window on click", () => {
  const exec = `'${VSCODE_CLI}' '/repo'`;
  const c = notifyCommand("darwin", "Summon", "done", {
    hasTerminalNotifier: true,
    bundleId: "com.microsoft.VSCode",
    executeCommand: exec,
  })!;
  expect(c.cmd).toBe("terminal-notifier");
  expect(c.args).toEqual([
    "-title", "Summon", "-message", "done", "-sound", "Ping",
    "-execute", exec,
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

test("matrix · VS Code + terminal-notifier → click runs the editor CLI to focus the project window", () => {
  const c = cmdFor({
    platform: "darwin",
    env: { VSCODE_GIT_ASKPASS_MAIN: VSCODE_ASKPASS, __CFBundleIdentifier: "com.microsoft.VSCode" },
    hasTerminalNotifier: true,
    cwd: "/Users/a/proj",
    editorCli: VSCODE_CLI,
  })!;
  expect(c.cmd).toBe("terminal-notifier");
  expect(c.args.slice(-2)).toEqual(["-execute", `'${VSCODE_CLI}' '/Users/a/proj'`]);
});

test("matrix · Cursor + terminal-notifier → runs the Cursor CLI, not VS Code's", () => {
  const c = cmdFor({
    platform: "darwin",
    env: { VSCODE_GIT_ASKPASS_MAIN: CURSOR_ASKPASS, __CFBundleIdentifier: "com.todesktop.x" },
    hasTerminalNotifier: true,
    cwd: "/repo",
    editorCli: CURSOR_CLI,
  })!;
  expect(c.args.at(-1)).toBe(`'${CURSOR_CLI}' '/repo'`);
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
