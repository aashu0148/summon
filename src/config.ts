import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// Persisted user preferences (currently just the theme). Stored as JSON at
// ~/.config/summon/config.json.

export type Config = { theme?: string };

const CONFIG_PATH = join(homedir(), ".config", "summon", "config.json");

export function loadConfig(): Config {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function saveConfig(patch: Config): void {
  try {
    const next = { ...loadConfig(), ...patch };
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  } catch {
    // best-effort: preferences just won't persist
  }
}
