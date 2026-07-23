# Caveman mode — implementation plan

**Spec / source:** `docs/superpowers/specs/2026-07-23-caveman-mode-design.md`
**Branch:** master (user branches/commits themselves — do NOT git commit)

## Progress
- [x] Task 1: Create the pure caveman domain module + tests
- [x] Task 2: Add the /caveman command to commands.ts + tests
- [x] Task 3: Wire the toggle into app.tsx send paths

## Dependencies
Task 2 needs Task 1. Task 3 needs Tasks 1–2. None parallel.

---

## Task 1: Create the pure caveman domain module + tests

**Depends on:** none
**Files:**
- Create: `src/domain/caveman.ts`
- Create: `tests/domain/caveman.test.ts`

**Steps:**
1. Create `src/domain/caveman.ts` with exactly:

```ts
// /caveman — a session-wide toggle that makes Claude answer terse. When on, every
// outgoing user message gets this style instruction appended to the WIRE text only;
// the transcript shows what the user typed (sendPrompt display ≠ wire). Pure so the
// wrap logic is unit-tested; the flag itself lives in app state (see app.tsx).

export const CAVEMAN_INSTRUCTION = [
  "STYLE (persistent, apply to this reply): answer caveman-terse.",
  "Drop articles, filler words, pleasantries, hedging. Fragments OK. Short synonyms",
  "(big not extensive, fix not implement-a-solution). No decorative tables or emoji.",
  "Keep code blocks, commands, technical terms, API names, and error strings exact.",
  "Pattern: [thing] [action] [reason]. [next step].",
  "Exception — use normal clear prose for security warnings, irreversible-action",
  "confirmations, or multi-step sequences where terseness risks misreading.",
].join("\n");

/** Wire text for an outgoing message: unchanged when off, instruction appended when on. */
export function wrapPrompt(text: string, on: boolean): string {
  return on ? `${text}\n\n${CAVEMAN_INSTRUCTION}` : text;
}
```

2. Create `tests/domain/caveman.test.ts` (mirror the import/describe style of
   `tests/domain/quick-ask.test.ts`) with tests asserting:
   - `wrapPrompt("hi", false)` returns exactly `"hi"`.
   - `wrapPrompt("hi", true)` starts with `"hi\n\n"` and contains `CAVEMAN_INSTRUCTION`.
   - `wrapPrompt("", true)` still contains the instruction (empty text edge).

**Verify:**
```bash
bun test tests/domain/caveman.test.ts
# Expected: all tests pass, 0 fail
```

**Out of scope:** commands.ts, app.tsx, any UI file.

## Task 2: Add the /caveman command to commands.ts + tests

**Depends on:** Task 1
**Files:**
- Modify: `src/domain/commands.ts` — add `toggleCaveman` to `CommandCtx`, add the command
- Modify: `tests/domain/commands.test.ts` — extend `stubCtx()`, add dispatch tests

**Steps:**
1. In `src/domain/commands.ts`, add to `CommandCtx` (after the `quickAsk` member):
```ts
  /** flip caveman (terse-reply) mode; returns the new state */
  toggleCaveman: () => boolean;
```
2. Add to `COMMANDS` (after the `ask` entry, before `usage`):
```ts
  {
    name: "caveman",
    description: "toggle terse caveman-style replies",
    run: (_args, ctx) => {
      const on = ctx.toggleCaveman();
      ctx.print(on ? "caveman mode on — replies will be terse" : "caveman mode off");
    },
  },
```
3. In `tests/domain/commands.test.ts`, extend `stubCtx()` with a recorded toggle
   (default flips an internal boolean and returns it), then add a describe block:
   - `dispatchCommand("/caveman", ctx, COMMANDS)` returns true, first print contains
     `"caveman mode on"`.
   - dispatching twice prints `"caveman mode off"` the second time.

**Verify:**
```bash
bun test tests/domain/commands.test.ts
# Expected: all tests pass, 0 fail (existing stubCtx-based tests still compile)
```

**Out of scope:** app.tsx wiring, caveman.ts changes.

## Task 3: Wire the toggle into app.tsx send paths

**Depends on:** Tasks 1–2
**Files:**
- Modify: `src/ui/app.tsx` — hold the flag, wrap wire text on both send paths
- Copy from (precedent): `src/ui/app.tsx` — the existing `themeName` useState +
  `ctx` construction (lines ~31, ~71–96)

**Steps:**
1. Import at the top of `app.tsx`: `import { wrapPrompt } from "../domain/caveman.ts";`
2. In `App()`, next to the `themeName` state: `const [caveman, setCaveman] = useState(false);`
3. Add a single wrapped-send helper above `ctx` so both paths share it:
```ts
  // Caveman mode appends the terse-style instruction to the WIRE text only; the
  // transcript (display) always shows what the user/skill actually wrote.
  const send = (wire: string, display = wire, images?: Parameters<typeof conv.enqueueOrSend>[2]) =>
    conv.enqueueOrSend(wrapPrompt(wire, caveman), display, images);
```
4. In `ctx`, change `sendPrompt: conv.enqueueOrSend` to `sendPrompt: send`, and add:
```ts
    toggleCaveman: () => {
      const next = !caveman;
      setCaveman(next);
      return next;
    },
```
5. In `submit()`, change the final line `conv.enqueueOrSend(text, text, images.length ? images : undefined);`
   to `send(text, text, images.length ? images : undefined);`
6. If `CommandCtx` type errors appear anywhere else constructing a ctx, STOP and
   report — only `app.tsx` and the test stub should construct one.

**Verify:**
```bash
bun test
# Expected: full suite passes, 0 fail
bunx tsc --noEmit
# Expected: no type errors
```
Then manual (untestable OpenTUI rendering, per CLAUDE.md): run `bun run start`,
type `/caveman` → SYS line "caveman mode on — replies will be terse"; send a message
and confirm the transcript shows only your typed text; `/caveman` again → "caveman mode off".

**Out of scope:** persisting the flag to config, footer indicator, /ask (Haiku) path.
