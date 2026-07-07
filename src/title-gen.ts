// Model-generated chat titles. Instead of using the raw first user message as the
// tab title (see title.ts / titleLabel), we ask a cheap model (Haiku) to read the
// opening exchange and name what the session is actually about. Fired once, after
// the first turn completes (app.tsx), with titleLabel as the instant fallback until
// the model answers.
//
// Pure logic (prompt building + output cleanup) lives here so it's unit-tested;
// generateTitle() is the thin, side-effecting spawn wrapper and isn't tested offline.

import { spawn } from "node:child_process";

// The model the CLI uses for the title call. Haiku is cheap and fast; a title is a
// trivial task, so we don't burn Opus/Sonnet budget on it.
export const TITLE_MODEL = "claude-haiku-4-5";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

// Build the instruction sent to the title model. The opening exchange is quoted as
// data to LABEL, not a conversation to continue — otherwise the model just echoes
// the assistant's clarifying question ("What do you want to refactor?") as the title.
export function buildTitlePrompt(userMsg: string, assistantMsg: string, max = 6): string {
  const user = oneLine(userMsg).slice(0, 2000);
  const assistant = oneLine(assistantMsg).slice(0, 2000);
  return [
    "You are labeling a chat for a list of tabs. Below is the opening of a coding",
    "session, quoted as data. Do NOT respond to it or answer any question in it.",
    `Output ONLY a title: a ${max}-word-max noun phrase naming the task or topic`,
    "(e.g. \"Refactor auth module\", \"Fix websocket reconnect\"). Never phrase it as a",
    "question or a reply. If the topic is still vague, name the general activity",
    "(e.g. \"Code refactoring\"). No quotes, no trailing punctuation, no \"Title:\" prefix.",
    "",
    "--- BEGIN SESSION ---",
    `User: ${user}`,
    assistant ? `Assistant: ${assistant}` : "",
    "--- END SESSION ---",
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
// of claude-session.ts). We spawn a throwaway *interactive* stream-json claude — the
// same subscription-billed path (apiKeySource=none) the main chat uses — write one
// title prompt on stdin, and read the final `result` event off stdout, then kill it.
// app.tsx fires this exactly once per session.
//
// Two Bun/CLI quirks this works around, both of which silently swallowed the reply:
//   1. We write the prompt to stdin *immediately* — claude keeps its stdout buffered
//      until it receives input, so waiting for the `init` event first deadlocks.
//   2. We parse stdout with a raw `data` handler + manual line-splitting rather than
//      node:readline, whose createInterface over a child pipe can stall after the
//      first line in a non-TTY context.
// We read until the `result` event, whose `result` field is the full reply text.
const BASE_ARGS = [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--permission-prompt-tool", "stdio",
];

export function generateTitle(
  userMsg: string,
  assistantMsg: string,
  opts: { model?: string; max?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  const { model = TITLE_MODEL, max = 40, timeoutMs = 30000 } = opts;
  const prompt = buildTitlePrompt(userMsg, assistantMsg);

  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    let done = false;
    let proc: ReturnType<typeof spawn> | null = null;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { proc?.kill("SIGTERM"); } catch {}
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      proc = spawn("claude", [...BASE_ARGS, "--model", model], {
        stdio: ["pipe", "pipe", "ignore"],
        env,
        cwd: process.cwd(),
      });
    } catch {
      return finish(null);
    }

    // Send the prompt up front (see quirk #1) — the message queues until the session
    // is ready, then claude flushes its stream and processes it.
    proc.stdin!.write(
      JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } }) + "\n",
    );

    let buf = "";
    proc.stdout!.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let json: any;
        try { json = JSON.parse(line); } catch { continue; }
        if (json.type === "result") finish(sanitizeTitle(json.result ?? "", max) || null);
      }
    });
    proc.on("error", () => finish(null));
    proc.on("close", () => finish(null)); // closed before a result → keep the fallback
  });
}
