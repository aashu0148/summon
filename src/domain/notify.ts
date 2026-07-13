// Real OS-level desktop notification — the reliable way to reach a user who's switched to a
// different app entirely (browser, etc.). Terminal escapes (bell, OSC 9) are too inconsistent:
// VS Code / Cursor's integrated terminal, for one, just flashes the tab instead of raising a
// system banner. So we shell out to the platform notifier. The platform→command mapping and
// the click-target derivation are pure and unit-tested here; the spawn / tool + env detection
// is a thin side-effecting wrapper.

import { existsSync, readFileSync } from "node:fs";

export type NotifyCmd = { cmd: string; args: string[] };

export type NotifyOpts = {
  // macOS host-app bundle id (from __CFBundleIdentifier), e.g. "com.microsoft.VSCode". Used to
  // activate the whole app on click when we can't target a specific window.
  bundleId?: string;
  // A shell command to run when the banner is clicked (terminal-notifier -execute). We use it to
  // focus the *exact* window a session runs in — see openFolderCommand. Takes precedence over
  // bundleId activation, which can only bring the app's frontmost window forward.
  executeCommand?: string;
  // Whether `terminal-notifier` is on PATH. It's the only macOS notifier that supports click
  // actions; without it we fall back to osascript, which shows a banner but can't act on click.
  hasTerminalNotifier?: boolean;
};

// Escape for embedding inside an AppleScript double-quoted string.
const escOsa = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
// Escape for a single-quoted PowerShell string.
const escPs = (s: string) => s.replace(/'/g, "''");
// Wrap a string as a single-quoted shell token, safe for arbitrary paths.
const shQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

// The .app bundle path of the editor hosting this terminal, derived from an env var VS Code /
// Cursor / Windsurf all export (VSCODE_GIT_ASKPASS_MAIN), which points inside the running app
// bundle — e.g. "/Applications/Visual Studio Code.app/Contents/Resources/...". This is more
// reliable than PATH lookups: it names the *exact* app, so a session in Cursor doesn't get
// pointed at VS Code just because both CLIs are installed. Undefined outside those editors.
export function editorAppBundle(askpassMain: string | undefined): string | undefined {
  if (!askpassMain) return undefined;
  const i = askpassMain.indexOf(".app/");
  return i === -1 ? undefined : askpassMain.slice(0, i + 4); // up to and including ".app"
}

// Candidate CLI paths inside an editor's app bundle, best-first. Each editor ships its own CLI
// under Contents/Resources/app/bin (VS Code → "code", Cursor → "cursor", …); only its own name
// exists there, so probing these disambiguates the editor without PATH guesswork. We use the
// bundled CLI — not `open -a` — because `open` sends an "open folder" event that VS Code often
// answers by spawning a NEW window, whereas the CLI focuses the window already showing it.
export function editorCliCandidates(appBundle: string): string[] {
  const bin = `${appBundle}/Contents/Resources/app/bin`;
  return ["code", "code-insiders", "cursor", "windsurf", "codium"].map((n) => `${bin}/${n}`);
}

// Click action for an editor session: run the editor's CLI on this folder. When the folder is
// already open in a window, the editor focuses *that* window — the one running the session —
// instead of opening a duplicate or surfacing whatever window happened to be frontmost.
export function openFolderCommand(editorCli: string, folder: string): string {
  return `${shQuote(editorCli)} ${shQuote(folder)}`;
}

// A "file://" URI (or already-plain path) → filesystem path. undefined if unparseable.
export function uriToPath(folder: string | undefined): string | undefined {
  if (!folder) return undefined;
  if (!folder.startsWith("file://")) return folder;
  try { return decodeURIComponent(new URL(folder).pathname); } catch { return undefined; }
}

// The folder paths of every currently-open editor window, parsed from VS Code / Cursor's
// globalStorage `storage.json` (its `windowsState`). This is the ground truth for what's open —
// no guessing, no permissions, just reading a JSON file the editor maintains.
export function parseOpenFolders(storageJson: string): string[] {
  try {
    const ws = (JSON.parse(storageJson).windowsState ?? {}) as {
      openedWindows?: { folder?: string }[];
      lastActiveWindow?: { folder?: string };
    };
    return [...(ws.openedWindows ?? []), ws.lastActiveWindow]
      .map((w) => uriToPath(w?.folder))
      .filter((p): p is string => !!p);
  } catch {
    return [];
  }
}

// The open workspace that actually contains cwd — the deepest open folder that is cwd or an
// ancestor of it. That's the exact folder the editor has open, so handing it to the CLI focuses
// that window instead of spawning a duplicate. undefined if no open window contains cwd.
export function pickWorkspaceFolder(cwd: string, openFolders: string[]): string | undefined {
  const contains = (f: string) => cwd === f || cwd.startsWith(f.endsWith("/") ? f : f + "/");
  return openFolders.filter(contains).sort((a, b) => b.length - a.length)[0];
}

// Which folder to hand the editor so it focuses the RIGHT window. Prefer an actually-open
// workspace that contains cwd (guaranteed to focus, never duplicates — this is the reliable
// path). Only if nothing open contains cwd do we fall back: the git root, then cwd.
export function focusFolder(cwd: string, openFolders: string[], gitToplevel: string | undefined): string {
  return pickWorkspaceFolder(cwd, openFolders) ?? gitToplevel?.trim() ?? cwd;
}

// VS Code's user-data dir name differs from its bundle name ("Visual Studio Code" → "Code");
// Cursor/Windsurf/VSCodium match. Used to locate that editor's storage.json.
export function editorDataDirName(appBundle: string): string {
  const base = (appBundle.split("/").pop() ?? "").replace(/\.app$/, "");
  return base.startsWith("Visual Studio Code") ? base.replace("Visual Studio Code", "Code") : base;
}

// Build the notifier invocation for a platform, or null if we don't know how to notify there.
// Args are passed to spawn directly (no shell), so titles/messages can't inject commands.
export function notifyCommand(platform: NodeJS.Platform, title: string, message: string, opts: NotifyOpts = {}): NotifyCmd | null {
  if (platform === "darwin") {
    // Preferred: terminal-notifier, so a click can focus the terminal.
    if (opts.hasTerminalNotifier) {
      const args = ["-title", title, "-message", message, "-sound", "Ping"];
      // -execute focuses the exact window (its CLI selects the right one), but the shell command
      // it runs counts as a background process to macOS's focus-stealing prevention, which
      // suppresses the raise. -activate uses the OS-native "bring app forward" path, which the
      // system honors from a notification click. Pass BOTH: -activate guarantees the raise,
      // -execute lands on the correct window. (An OS update that resets terminal-notifier's trust
      // state will otherwise silently break -execute-only clicks — see focus-stealing prevention.)
      if (opts.executeCommand) args.push("-execute", opts.executeCommand);
      if (opts.bundleId) args.push("-activate", opts.bundleId);
      return { cmd: "terminal-notifier", args };
    }
    // Fallback: a plain banner (no click action — osascript can't activate another app).
    return {
      cmd: "osascript",
      args: ["-e", `display notification "${escOsa(message)}" with title "${escOsa(title)}" sound name "Ping"`],
    };
  }
  if (platform === "linux") {
    return { cmd: "notify-send", args: [title, message] };
  }
  if (platform === "win32") {
    const ps =
      `[reflection.assembly]::LoadWithPartialName('System.Windows.Forms') > $null;` +
      `$n = New-Object System.Windows.Forms.NotifyIcon;` +
      `$n.Icon = [System.Drawing.SystemIcons]::Information;` +
      `$n.Visible = $true;` +
      `$n.ShowBalloonTip(5000, '${escPs(title)}', '${escPs(message)}', 'Info')`;
    return { cmd: "powershell", args: ["-NoProfile", "-Command", ps] };
  }
  return null;
}

// A one-time startup hint nudging macOS users to install terminal-notifier for click-to-focus.
// Only on macOS and only when it's missing — notifications work regardless, so this is purely
// about the click-to-focus upgrade. null ⇒ show nothing (already installed, or non-macOS).
export function terminalNotifierHint(platform: NodeJS.Platform, hasTerminalNotifier: boolean): string | null {
  if (platform !== "darwin" || hasTerminalNotifier) return null;
  return "tip: run `brew install terminal-notifier` so clicking a notification jumps back to this window — notifications work without it.";
}

// The bits of the environment that shape a macOS notification's click behavior.
export type NotifyEnv = { VSCODE_GIT_ASKPASS_MAIN?: string; __CFBundleIdentifier?: string; [k: string]: string | undefined };

// Turn the ambient environment into notify options — the whole click-behavior decision, kept
// pure so the full terminal matrix (VS Code / Cursor / iTerm2 / Terminal.app / non-macOS, with
// or without terminal-notifier) is unit-testable without spawning anything. Only macOS has
// click targeting; elsewhere the platform notifier just shows a banner, so options are empty.
export function resolveNotifyOpts(input: {
  platform: NodeJS.Platform;
  env: NotifyEnv;
  hasTerminalNotifier: boolean;
  cwd: string;
  editorCli?: string; // resolved bundled-CLI path for the host editor, if any (side-effecting to find)
}): NotifyOpts {
  const { platform, env, hasTerminalNotifier, cwd, editorCli } = input;
  if (platform !== "darwin") return {};
  return {
    hasTerminalNotifier,
    bundleId: env.__CFBundleIdentifier, // app-level focus fallback (iTerm2, Terminal.app, …)
    executeCommand: editorCli ? openFolderCommand(editorCli, cwd) : undefined, // exact-window focus for editors
  };
}

// Locate the running editor's own CLI (side-effecting: touches the filesystem). Probes the
// bundle's bin dir for the one CLI it ships; undefined outside an editor or if none is found.
function resolveEditorCli(env: NotifyEnv): string | undefined {
  const bundle = editorAppBundle(env.VSCODE_GIT_ASKPASS_MAIN);
  if (!bundle) return undefined;
  return editorCliCandidates(bundle).find((p) => existsSync(p));
}

// The git repo root of `cwd`, or undefined outside a repo / if git is unavailable (side-effecting).
function gitToplevel(cwd: string): string | undefined {
  try {
    const r = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "ignore" });
    return r.success ? r.stdout.toString().trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

// Read the host editor's list of open window folders from its storage.json (side-effecting).
// Empty outside an editor or if the file can't be read/parsed.
function readOpenFolders(env: NotifyEnv): string[] {
  const bundle = editorAppBundle(env.VSCODE_GIT_ASKPASS_MAIN);
  const home = process.env.HOME;
  if (!bundle || !home) return [];
  const path = `${home}/Library/Application Support/${editorDataDirName(bundle)}/User/globalStorage/storage.json`;
  try {
    return parseOpenFolders(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

// Fire-and-forget the desktop notification. Best-effort: if the notifier is missing or fails
// (no notify-send installed, etc.) we swallow it — a missed nudge must never crash a turn.
// terminal-notifier is optional: present ⇒ click-to-focus, absent ⇒ plain osascript banner.
export function sendNotification(title: string, message: string): void {
  const darwin = process.platform === "darwin";
  const cwd = process.cwd();
  const opts = resolveNotifyOpts({
    platform: process.platform,
    env: process.env,
    hasTerminalNotifier: darwin && Bun.which("terminal-notifier") != null,
    // Focus the exact open workspace window that contains cwd (from the editor's own state),
    // not a deep cwd or a mis-guessed git root that would spawn a duplicate window.
    cwd: darwin ? focusFolder(cwd, readOpenFolders(process.env), gitToplevel(cwd)) : cwd,
    editorCli: darwin ? resolveEditorCli(process.env) : undefined,
  });
  const c = notifyCommand(process.platform, title, message, opts);
  if (!c) return;
  try {
    Bun.spawn([c.cmd, ...c.args], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // ignore — notifier unavailable
  }
}
