import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// Model-generated session titles (see title-gen.ts), persisted so the /resume
// picker shows the same meaningful name as the terminal tab instead of the raw,
// often-vague first user message. Keyed by full Claude session id, stored as JSON
// at ~/.config/summon/titles.json alongside config.json.

export type TitleStore = Record<string, string>;

const STORE_PATH = join(homedir(), ".config", "summon", "titles.json");

// Pure merge: drop empty ids/titles so we never persist junk, otherwise upsert.
export function withTitle(store: TitleStore, sessionId: string, title: string): TitleStore {
  if (!sessionId || !title) return store;
  return { ...store, [sessionId]: title };
}

export function loadTitles(path = STORE_PATH): TitleStore {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    return j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

export function saveTitle(sessionId: string, title: string, path = STORE_PATH): void {
  if (!sessionId || !title) return;
  try {
    const next = withTitle(loadTitles(path), sessionId, title);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 2));
  } catch {
    // best-effort: the title just won't survive a restart
  }
}
