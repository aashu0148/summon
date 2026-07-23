# Cross-question mode — quick direct answers toggle

**Date:** 2026-07-23
**Status:** Approved design, pending implementation

## What

A `/crossquestion` slash command that toggles a persistent "quick direct answer"
mode for the main session, built for cross-questioning Claude about work it just
did (e.g. after screening a project). While on, Claude answers ONLY what was
asked, in the shortest form that fully answers — one word, one line, or one
short paragraph — spoken like a senior engineer explaining to a teammate:
high-level, simple plain language anyone can follow, teaching the idea rather
than dumping jargon (unavoidable terms get a few-word definition). No
suggestions, no next steps, no scope expansion, no restating the question. When
pointing at code, it cites `file:line`.

This generalizes the existing caveman mode (spec:
`2026-07-23-caveman-mode-design.md`) into a single "reply style" concept.
Caveman compresses grammar; crossquestion keeps normal grammar but minimizes
length and scope. The two are mutually exclusive — turning one on switches the
other off (stacked instructions would conflict).

## Why

After Claude finishes a task, the user fires a burst of verification questions
and wants each answered instantly, not wrapped in paragraphs. A toggle covers
the burst; `/crossquestion` again (or `/caveman`) ends it.

## How

Same mechanism as caveman: the active style's instruction is appended to the
**wire** text of each outgoing message; **display** stays what the user typed.
Session-only, no persistence, main session only (not `/ask`).

## Components

- **`src/domain/reply-style.ts`** (renamed from `src/domain/caveman.ts`, pure):
  - `type ReplyStyle = "caveman" | "crossquestion"`.
  - `INSTRUCTIONS: Record<ReplyStyle, string>` — caveman keeps its existing
    text; crossquestion says: answer only the asked question, shortest complete
    form (word / line / short paragraph), plain grammar, no suggestions or next
    steps or offers, no restating, cite `file:line` for code references, drop
    brevity for security warnings or irreversible-action confirmations.
  - `wrapPrompt(text: string, style: ReplyStyle | null): string` — unchanged
    when null; instruction appended when a style is active.
  - `toggleStyle(current: ReplyStyle | null, requested: ReplyStyle): ReplyStyle | null`
    — same as current → null (off); otherwise → requested (on / switched).
- **`src/domain/commands.ts`**:
  - `CommandCtx.toggleCaveman` is REPLACED by
    `setReplyStyle(style: ReplyStyle): ReplyStyle | null` — applies
    `toggleStyle` to app state and returns the new active style.
  - `/caveman` and `/crossquestion` commands both call it and print:
    `"caveman mode on — replies will be terse"` / `"crossquestion mode on — quick direct answers"`
    when activated, `"<name> mode off"` when deactivated. Switching prints the
    new mode's on-line (the old mode is implicitly off).
- **`src/ui/app.tsx`**: single `useState<ReplyStyle | null>(null)`; the shared
  `send` helper wraps wire text with `wrapPrompt(wire, replyStyle)`.

## Scope / non-goals

- Session-only, no config persistence, no footer indicator.
- Does not affect `/ask` (Haiku one-shot).
- No per-message variant, no intensity levels.
- `src/domain/caveman.ts` and `tests/domain/caveman.test.ts` are deleted
  (replaced by `reply-style.ts` / `reply-style.test.ts`).

## Error handling

None — pure string/state logic. Toggling mid-stream affects the next message.

## Testing

`tests/domain/reply-style.test.ts` (replaces `caveman.test.ts`):
- `wrapPrompt` unchanged when style is null; appends the right instruction per style.
- `toggleStyle`: null+caveman→caveman, caveman+caveman→null,
  caveman+crossquestion→crossquestion.

`tests/domain/commands.test.ts`:
- `/caveman` and `/crossquestion` each toggle on then off via dispatch.
- Dispatching `/caveman` then `/crossquestion` prints the crossquestion on-line
  (mutual exclusion — one active style).
