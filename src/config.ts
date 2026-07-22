import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// Persisted user preferences (theme, last-chosen model). Stored as JSON at
// ~/.config/summon/config.json.

export type Config = { theme?: string; model?: string };

// Resolved lazily (not frozen at import). SUMMON_CONFIG_DIR overrides the base
// dir — used by tests to avoid touching the real config (homedir() ignores $HOME
// on macOS, so an env seam is the reliable way to redirect it).
const configPath = () =>
  join(process.env.SUMMON_CONFIG_DIR ?? homedir(), ".config", "summon", "config.json");

export function loadConfig(): Config {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

export function saveConfig(patch: Config): void {
  try {
    const next = { ...loadConfig(), ...patch };
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 2));
  } catch {
    // best-effort: preferences just won't persist
  }
}
