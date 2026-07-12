// Real OS-level desktop notification — the reliable way to reach a user who's switched to a
// different app entirely (browser, etc.). Terminal escapes (bell, OSC 9) are too inconsistent:
// VS Code / Cursor's integrated terminal, for one, just flashes the tab instead of raising a
// system banner. So we shell out to the platform notifier. The platform→command mapping and
// the click-target derivation are pure and unit-tested here; the spawn / tool + env detection
// is a thin side-effecting wrapper.

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

// Click action for an editor session: reopen this folder in that editor. When the folder is
// already open in a window, the editor focuses *that* window — which is the one running the
// session — instead of whatever window happened to be frontmost.
export function openFolderCommand(appBundle: string, cwd: string): string {
  return `open -a ${shQuote(appBundle)} ${shQuote(cwd)}`;
}

// Build the notifier invocation for a platform, or null if we don't know how to notify there.
// Args are passed to spawn directly (no shell), so titles/messages can't inject commands.
export function notifyCommand(platform: NodeJS.Platform, title: string, message: string, opts: NotifyOpts = {}): NotifyCmd | null {
  if (platform === "darwin") {
    // Preferred: terminal-notifier, so a click can focus the terminal.
    if (opts.hasTerminalNotifier) {
      const args = ["-title", title, "-message", message, "-sound", "Ping"];
      if (opts.executeCommand) args.push("-execute", opts.executeCommand); // focus the exact window
      else if (opts.bundleId) args.push("-activate", opts.bundleId); // fall back to app-level focus
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
}): NotifyOpts {
  const { platform, env, hasTerminalNotifier, cwd } = input;
  if (platform !== "darwin") return {};
  const bundle = editorAppBundle(env.VSCODE_GIT_ASKPASS_MAIN);
  return {
    hasTerminalNotifier,
    bundleId: env.__CFBundleIdentifier, // app-level focus fallback (iTerm2, Terminal.app, …)
    executeCommand: bundle ? openFolderCommand(bundle, cwd) : undefined, // exact-window focus for editors
  };
}

// Fire-and-forget the desktop notification. Best-effort: if the notifier is missing or fails
// (no notify-send installed, etc.) we swallow it — a missed nudge must never crash a turn.
// terminal-notifier is optional: present ⇒ click-to-focus, absent ⇒ plain osascript banner.
export function sendNotification(title: string, message: string): void {
  const opts = resolveNotifyOpts({
    platform: process.platform,
    env: process.env,
    hasTerminalNotifier: process.platform === "darwin" && Bun.which("terminal-notifier") != null,
    cwd: process.cwd(),
  });
  const c = notifyCommand(process.platform, title, message, opts);
  if (!c) return;
  try {
    Bun.spawn([c.cmd, ...c.args], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // ignore — notifier unavailable
  }
}
