# Caveman Mode — terse replies toggle

**Date:** 2026-07-23
**Status:** Approved design, pending implementation

## What

A `/caveman` slash command that toggles a persistent "terse reply" mode for the
main session. While on, every reply from Claude comes back caveman-short: no
filler, no pleasantries, no hedging, fragments OK, short synonyms, no decorative
tables/emoji. Off restores normal style. Simple on/off — no intensity levels.

## Why

The user often wants quick, to-the-point answers without reading paragraphs.
A persistent toggle beats retyping "be brief" every message.

## How (approach A: prompt injection)

When the mode is on, the outgoing **wire** text of each user message gets a
short style instruction appended. The **display** text in the transcript stays
exactly what the user typed (`sendPrompt(text, display)` already supports
wire ≠ display). No session respawn, no `--append-system-prompt`, instant
toggle mid-session. Cost: ~60 extra input tokens per turn while on.

## Components

- **`src/domain/caveman.ts`** (new, pure):
  - `CAVEMAN_INSTRUCTION` — the style rules string (drop articles/filler/
    pleasantries/hedging, fragments OK, short synonyms, keep code/errors/
    technical terms exact, drop terseness for security warnings or
    irreversible-action confirmations).
  - `wrapPrompt(text: string, on: boolean): string` — returns `text` unchanged
    when off; when on, appends the instruction after a blank line.
- **`src/domain/commands.ts`**:
  - New `CommandCtx` member `toggleCaveman(): boolean` — flips the flag,
    returns the new state.
  - New command `{ name: "caveman", description: "toggle terse caveman-style replies" }`
    that calls `toggleCaveman()` and prints `caveman mode on — replies will be terse`
    or `caveman mode off`.
- **Send path** (`src/ui/hooks/useConversation.ts` / `app.tsx`): hold the flag
  in state; where user input is forwarded to the session, send
  `wrapPrompt(input, cavemanOn)` as wire text with the original input as
  display text.

## Scope / non-goals

- Session-only: not persisted to config across restarts.
- No footer/status-bar indicator; the SYS toggle line is the only feedback.
- Does not affect `/ask` (Haiku one-shot) — main session only.
- No lite/full/ultra levels.

## Error handling

None needed — pure string logic, no I/O. Toggling while a reply is streaming
affects the next message only (wrap happens at send time).

## Testing

`tests/domain/caveman.test.ts`:
- `wrapPrompt` returns input unchanged when off.
- `wrapPrompt` appends `CAVEMAN_INSTRUCTION` when on; original text preserved.
- `dispatchCommand("/caveman")` calls `toggleCaveman` and prints the on/off line
  matching the returned state.
