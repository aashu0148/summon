import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileChangeFromToolUse } from "./claude-session.ts";

// Claude Code stores each session as ~/.claude/projects/<encoded-cwd>/<id>.jsonl,
// where the cwd is encoded by replacing every "/" with "-".

export type SessionMeta = {
  id: string;
  summary: string; // first real user message, for the picker label
  mtimeMs: number;
};

// A reconstructed conversation entry for replaying a resumed session into the UI.
export type TranscriptTurn = { role: "you" | "claude" | "file"; text: string };

function projectDir(cwd: string): string {
  return join(homedir(), ".claude", "projects", cwd.replace(/\//g, "-"));
}

function firstUserText(file: string): string {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const lines = raw.split("\n");
  for (const line of lines.slice(0, 400)) {
    if (!line) continue;
    let j: any;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j?.type !== "user" || j?.message?.role !== "user") continue;
    const c = j.message.content;
    const text =
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ")
          : "";
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (cleaned) return cleaned;
  }
  return "";
}

/** Recent sessions for `cwd`, most-recent first (capped at `limit`). */
export function listSessions(cwd: string, limit = 20): SessionMeta[] {
  const dir = projectDir(cwd);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const metas: SessionMeta[] = [];
  for (const f of files) {
    const full = join(dir, f);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(full).mtimeMs;
    } catch {
      continue;
    }
    metas.push({ id: f.replace(/\.jsonl$/, ""), summary: firstUserText(full), mtimeMs });
  }
  metas.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return metas.slice(0, limit);
}

/**
 * Reconstruct a session's conversation from its transcript so a resumed chat shows its
 * history (user turns, assistant replies, and file-change lines) instead of a blank screen.
 * Reads the .jsonl and maps text blocks + file-mutating tool_use blocks into UI turns.
 */
export function loadTranscript(sessionId: string, cwd: string): TranscriptTurn[] {
  const file = join(projectDir(cwd), `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const turns: TranscriptTurn[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let j: any;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j?.type === "user" && j?.message?.role === "user") {
      const c = j.message.content;
      // Skip tool-result echoes (content blocks that aren't plain text).
      const text =
        typeof c === "string"
          ? c
          : Array.isArray(c)
            ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ")
            : "";
      const cleaned = text.trim();
      if (cleaned && !cleaned.startsWith("<")) turns.push({ role: "you", text: cleaned });
    } else if (j?.type === "assistant" && Array.isArray(j?.message?.content)) {
      for (const b of j.message.content) {
        if (b?.type === "text" && b.text?.trim()) turns.push({ role: "claude", text: b.text.trim() });
        else if (b?.type === "tool_use") {
          const fc = fileChangeFromToolUse(b.name, b.input);
          if (fc) {
            const rel = fc.path.startsWith(cwd + "/") ? fc.path.slice(cwd.length + 1) : fc.path;
            turns.push({ role: "file", text: `✎ ${rel}  +${fc.added} −${fc.removed}` });
          }
        }
      }
    }
  }
  return turns;
}

export function relativeTime(mtimeMs: number, now: number): string {
  const s = Math.max(0, Math.round((now - mtimeMs) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
