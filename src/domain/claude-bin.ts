/**
 * Cross-platform resolver for the `claude` CLI executable.
 *
 * `spawn("claude", ...)` makes two silent assumptions that only hold inside an
 * interactive shell, not a raw process spawn:
 *   1. Resolution  — the bare name `claude` is found via the inherited PATH.
 *   2. Executability — whatever it resolves to can be exec'd directly.
 *
 * Both break off the happy path:
 *   - macOS: a GUI- or non-login-launched process inherits a minimal PATH that
 *     omits ~/.claude/local, Homebrew, npm-global, etc. — so the bare name isn't found.
 *   - Windows: npm installs `claude.cmd` / `claude.ps1` shims. The kernel can't exec
 *     a `.cmd` directly; it must go through `cmd.exe` (i.e. spawn with shell:true),
 *     and PATHEXT (not PATH alone) is what makes the extension-less name resolve.
 *
 * This resolves a concrete path where possible so we never depend on shell magic,
 * and flags when the resolved target still needs a shell to launch (Windows shims).
 *
 * The resolver is pure (all IO injected) so it's unit-testable across simulated
 * platforms; `resolveClaudeLaunch()` is the real-IO wrapper the session/title-gen use.
 */

import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";

export type ClaudeLaunch = {
  /** command to hand to spawn() — a concrete path when resolved, else bare "claude" */
  command: string;
  /**
   * must the command run through a shell? (Windows .cmd/.bat/.ps1 shims)
   *
   * NOTE: when true, spawn's args go through cmd.exe and get re-parsed — args with
   * spaces/quotes/shell metachars (& | ^ %) would need escaping. Callers currently
   * pass only bare flags and safe values (model names, session UUIDs), so it's fine;
   * quote any free-text/path arg before spawning if that ever changes.
   */
  shell: boolean;
};

export type ResolveDeps = {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  /** true if `p` exists AND is runnable (X_OK on unix; mere existence on win) */
  canRun: (p: string) => boolean;
};

const SHELL_EXTS = [".cmd", ".bat", ".ps1"];

/** A Windows shim (.cmd/.bat/.ps1) can't be exec'd directly — it needs a shell. */
export function needsShell(command: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return false;
  const lower = command.toLowerCase();
  return SHELL_EXTS.some((ext) => lower.endsWith(ext));
}

/** join a dir + file with the platform's separator (kept pure — no node:path). */
function join(dir: string, file: string, platform: NodeJS.Platform): string {
  const s = platform === "win32" ? "\\" : "/";
  return dir.endsWith(s) || dir.endsWith("/") ? dir + file : dir + s + file;
}

/**
 * Ordered list of candidate paths to probe for `claude`, most-specific first:
 *   1. explicit override (SUMMON_CLAUDE_BIN / CLAUDE_BIN)
 *   2. every PATH dir × every executable extension
 *   3. well-known install locations the inherited PATH commonly misses
 */
export function claudeCandidates(deps: ResolveDeps): string[] {
  const { platform, env, home } = deps;
  const win = platform === "win32";
  const pathSep = win ? ";" : ":";
  const out: string[] = [];

  const override = env.SUMMON_CLAUDE_BIN || env.CLAUDE_BIN;
  if (override) out.push(override);

  // On Windows the extension-less name only resolves via PATHEXT; try each ext.
  const exts = win
    ? [".cmd", ".exe", ".bat", ".ps1", ""]
    : [""];

  const pathDirs = (env.PATH || env.Path || "").split(pathSep).filter(Boolean);
  for (const dir of pathDirs) {
    for (const ext of exts) out.push(join(dir, "claude" + ext, platform));
  }

  // Well-known locations a stripped GUI/login PATH tends to drop.
  if (win) {
    const appData = env.APPDATA;
    const local = env.LOCALAPPDATA;
    if (appData) for (const ext of exts) out.push(join(join(appData, "npm", platform), "claude" + ext, platform));
    if (local) for (const ext of exts) out.push(join(join(local, "Programs", platform), "claude" + ext, platform)); // native installer
  } else {
    const extras = [
      `${home}/.claude/local/claude`, // native installer
      `${home}/.local/bin/claude`,
      `${home}/.bun/bin/claude`,
      `${home}/.npm-global/bin/claude`,
      "/opt/homebrew/bin/claude", // Apple-silicon Homebrew
      "/usr/local/bin/claude",
      "/usr/bin/claude",
    ];
    out.push(...extras);
  }

  return out;
}

/**
 * Resolve how to launch `claude`. Returns the first candidate that exists & runs;
 * if none do, falls back to the bare name (with shell:true on Windows so cmd.exe
 * still applies PATHEXT). Pure — inject platform/env/home/canRun for testing.
 */
export function resolveClaudeLaunchWith(deps: ResolveDeps): ClaudeLaunch {
  for (const cand of claudeCandidates(deps)) {
    if (deps.canRun(cand)) return { command: cand, shell: needsShell(cand, deps.platform) };
  }
  // Nothing found — let the OS take a last shot at the bare name. On Windows that
  // MUST go through a shell for PATHEXT to apply; on unix a bare spawn is fine.
  return { command: "claude", shell: deps.platform === "win32" };
}

/** Real-IO wrapper: probe the actual filesystem for the current platform. */
export function resolveClaudeLaunch(): ClaudeLaunch {
  const platform = process.platform;
  const canRun = (p: string): boolean => {
    try {
      if (platform === "win32") return existsSync(p);
      accessSync(p, constants.X_OK); // exists AND executable
      return true;
    } catch {
      return false;
    }
  };
  return resolveClaudeLaunchWith({ platform, env: process.env, home: homedir(), canRun });
}
