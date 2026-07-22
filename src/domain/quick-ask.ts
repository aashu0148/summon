// /ask — a cheap, fast one-shot answer from Haiku that reads only the last few turns of
// the current chat as context. It does NOT go through the main session: no wire message,
// no context growth, no Opus/Sonnet spend. It fires a throwaway subscription-billed Haiku
// call (see oneshot.ts) purely to answer a quick question or help brainstorm on the side.
//
// Pure logic (which turns count as context, prompt building, reply cleanup) lives here so
// it's unit-tested; quickAsk() is the thin spawn wrapper and isn't tested offline.

import { oneLine } from "../lib/format.ts";
import { runOneShot } from "./oneshot.ts";

// Haiku is cheap and fast — the whole point of /ask is a low-token answer, so we never
// route it to Opus/Sonnet regardless of the main chat's current model.
export const ASK_MODEL = "claude-haiku-4-5";

// How many recent conversation turns to send as context, per the user's request. Enough
// to make the answer relevant without ballooning the token cost.
export const ASK_CONTEXT_TURNS = 7;

// Only "you"/"claude" turns carry real conversation content. Tool, file, sys, usage and
// error lines are UI noise for a brainstorming answer, so we drop them from the context.
const CONTENT_ROLES = new Set(["you", "claude"]);

export type AskTurn = { role: string; text: string };

/**
 * Build the Haiku prompt: the last `n` content turns quoted as prior context, then the
 * question. The transcript is data to INFORM the answer, not a conversation to continue,
 * so we label the speakers and ask for a direct, concise reply.
 */
export function buildAskPrompt(turns: AskTurn[], question: string, n = ASK_CONTEXT_TURNS): string {
  const recent = turns.filter((t) => CONTENT_ROLES.has(t.role)).slice(-n);
  const history = recent
    .map((t) => `${t.role === "you" ? "User" : "Assistant"}: ${oneLine(t.text).slice(0, 2000)}`)
    .join("\n");
  return [
    "You are a fast helper answering a quick question during a coding chat. Below is the",
    "recent conversation, quoted as data — use it only if relevant to the question. Answer",
    "directly and concisely (a few sentences at most), no preamble, no restating the question.",
    "",
    history ? "--- RECENT CONTEXT ---" : "",
    history,
    history ? "--- END CONTEXT ---" : "",
    "",
    `Question: ${oneLine(question).slice(0, 4000)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Fire `question` at Haiku with the last `n` content turns as context. Resolves the
 * trimmed answer text, or null on any failure/timeout (caller shows a fallback).
 */
export function quickAsk(
  turns: AskTurn[],
  question: string,
  opts: { model?: string; n?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  const { model = ASK_MODEL, n = ASK_CONTEXT_TURNS, timeoutMs = 30000 } = opts;
  const prompt = buildAskPrompt(turns, question, n);
  return runOneShot(prompt, { model, timeoutMs }).then((raw) => {
    const s = (raw ?? "").trim();
    return s || null;
  });
}
