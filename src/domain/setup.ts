// The onboarding plan run by `bun run setup` (scripts/setup.ts) — the one command a new user
// runs instead of `bun install` + `bun link`. Kept pure so the platform branching (what gets
// installed where) is unit-tested without shelling out or being on that OS. The runner just
// probes the environment (Bun.which) and executes these steps in order.

export type SetupStep =
  | { kind: "run"; cmd: string[]; label: string; optional?: boolean } // optional ⇒ failure warns, doesn't abort
  | { kind: "info"; message: string }
  | { kind: "warn"; message: string };

export type SetupProbe = { hasBrew: boolean; hasTerminalNotifier: boolean };

export function setupPlan(platform: NodeJS.Platform, probe: SetupProbe): SetupStep[] {
  const steps: SetupStep[] = [
    { kind: "run", cmd: ["bun", "install"], label: "install dependencies" },
    { kind: "run", cmd: ["bun", "link"], label: "expose the `summon` command on your PATH" },
  ];

  // Desktop notifications themselves need no install anywhere (macOS osascript, Windows
  // PowerShell, Linux notify-send). The only optional extra is macOS terminal-notifier, which
  // upgrades a notification click to focus the exact terminal window the session runs in.
  if (platform === "darwin") {
    if (probe.hasTerminalNotifier) {
      steps.push({ kind: "info", message: "terminal-notifier already installed — clicking a notification will focus your session's window." });
    } else if (probe.hasBrew) {
      steps.push({
        kind: "run",
        cmd: ["brew", "install", "terminal-notifier"],
        label: "install terminal-notifier (lets a notification click jump you back to the session)",
        optional: true, // notifications still work without it — never fail setup over this
      });
    } else {
      steps.push({ kind: "warn", message: "Homebrew not found — skipping terminal-notifier. Notifications still work; run `brew install terminal-notifier` later to add click-to-focus." });
    }
  } else if (platform === "win32") {
    steps.push({ kind: "info", message: "Windows: notifications use built-in PowerShell — nothing to install. (Click-to-focus isn't available on Windows.)" });
  } else {
    steps.push({ kind: "info", message: "Linux: notifications use `notify-send`. If none appear, install libnotify (e.g. `sudo apt install libnotify-bin`)." });
  }

  return steps;
}
