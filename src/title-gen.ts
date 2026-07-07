// Model-generated chat titles. Instead of using the raw first user message as the
// tab title (see title.ts / titleLabel), we ask a cheap model (Haiku) to read the
// opening exchange and name what the session is actually about. Fired once, after
// the first turn completes (app.tsx), with titleLabel as the instant fallback until
// the model answers.
//
// Pure logic (prompt building + output cleanup) lives here so it's unit-tested;
// generateTitle() is the thin, side-effecting spawn wrapper and isn't tested offline.

import { ClaudeSession, type SessionEvent } from "./claude-session.ts";

// The model the CLI uses for the title call. Haiku is cheap and fast; a title is a
// trivial task, so we don't burn Opus/Sonnet budget on it.
export const TITLE_MODEL = "claude-haiku-4-5";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

// Build the instruction sent to the title model. We pass the opening exchange and
// ask for a terse, intentful label — no punctuation, quotes, or filler.
export function buildTitlePrompt(userMsg: string, assistantMsg: string, max = 6): string {
  const user = oneLine(userMsg).slice(0, 2000);
  const assistant = oneLine(assistantMsg).slice(0, 2000);
  return [
    `Write a title of at most ${max} words naming what this coding session is about.`,
    "Capture the concrete task or intent, not the greeting. Use no quotes, no trailing",
    "punctuation, and no prefix like \"Title:\". Reply with the title only.",
    "",
    `User: ${user}`,
    assistant ? `Assistant: ${assistant}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// Clean the model's raw reply into a usable title: collapse whitespace, drop a
// leading "Title:" label, strip surrounding quotes and trailing punctuation, then
// truncate. Returns "" if nothing usable is left (caller keeps the fallback).
export function sanitizeTitle(raw: string, max = 40): string {
  let s = oneLine(raw);
  s = s.replace(/^title\s*[:\-]\s*/i, "");
  // Peel surrounding quotes and trailing punctuation until stable — handles both
  // `"Fix parser".` and `Fix parser."` regardless of which layer is outermost.
  let prev;
  do {
    prev = s;
    s = s.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "");
    s = s.replace(/[.。!?]+$/g, "").trim();
  } while (s !== prev);
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Name the session with a cheap model. Resolves to the sanitized title, or null on
// any failure/timeout — the caller falls back to titleLabel.
//
// IMPORTANT: we do NOT use `claude -p` / --print here. That path routes to the SDK
// credit pool / API key, which is exactly what this project avoids (see the header
// of claude-session.ts). Instead we spawn a throwaway *interactive* stream-json
// ClaudeSession — the same subscription-billed path the main chat uses — send one
// title prompt, take the first assistant turn, and kill it. app.tsx fires this once.
export function generateTitle(
  userMsg: string,
  assistantMsg: string,
  opts: { model?: string; max?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  const { model = TITLE_MODEL, max = 40, timeoutMs = 30000 } = opts;
  const prompt = buildTitlePrompt(userMsg, assistantMsg);

  return new Promise((resolve) => {
    const session = new ClaudeSession();
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { session.kill(); } catch {}
      resolve(v);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    session.on("event", (e: SessionEvent) => {
      if (e.type === "init") session.send(prompt);
      else if (e.type === "assistant_done") finish(sanitizeTitle(e.text, max) || null);
      else if (e.type === "exit") finish(null); // premature exit → keep the fallback
    });

    try {
      session.spawn({ model });
    } catch {
      finish(null);
    }
  });
}
