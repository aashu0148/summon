# Cross-question mode — implementation plan

**Spec / source:** `docs/superpowers/specs/2026-07-23-crossquestion-mode-design.md`
**Branch:** master (user branches/commits themselves — do NOT git commit)

Baseline note: the caveman-mode change (`.plans/2026-07-23-caveman-mode.md`) is
implemented but uncommitted in the working tree. This plan refactors it.
`bunx tsc --noEmit` has exactly 2 pre-existing errors at baseline
(`scripts/title-probe.ts`, `tests/domain/commands.test.ts`) — "no new errors"
means the error list stays exactly those two.

## Progress
- [x] Task 1: Replace caveman.ts with the generalized reply-style module + tests
- [x] Task 2: Rework commands.ts to setReplyStyle + add /crossquestion + tests
- [x] Task 3: Rewire app.tsx to the single reply-style state

## Dependencies
Task 2 needs Task 1. Task 3 needs Tasks 1–2. None parallel.

---

## Task 1: Replace caveman.ts with the generalized reply-style module + tests

**Depends on:** none
**Files:**
- Create: `src/domain/reply-style.ts`
- Create: `tests/domain/reply-style.test.ts`
- Delete: `src/domain/caveman.ts`
- Delete: `tests/domain/caveman.test.ts`

**Steps:**
1. Create `src/domain/reply-style.ts` with exactly:

```ts
// Reply styles — session-wide toggles that shape how Claude answers. While one is
// active, every outgoing user message gets its instruction appended to the WIRE
// text only; the transcript shows what the user typed (sendPrompt display ≠ wire).
// One style at a time — stacked instructions would conflict, so activating one
// replaces the other. Pure so the wrap/toggle logic is unit-tested; the active
// style itself lives in app state (see app.tsx).

export type ReplyStyle = "caveman" | "crossquestion";

export const INSTRUCTIONS: Record<ReplyStyle, string> = {
  // Compress the GRAMMAR: shortest possible phrasing, fragments allowed.
  caveman: [
    "STYLE (persistent, apply to this reply): answer caveman-terse.",
    "Drop articles, filler words, pleasantries, hedging. Fragments OK. Short synonyms",
    "(big not extensive, fix not implement-a-solution). No decorative tables or emoji.",
    "Keep code blocks, commands, technical terms, API names, and error strings exact.",
    "Pattern: [thing] [action] [reason]. [next step].",
    "Exception — use normal clear prose for security warnings, irreversible-action",
    "confirmations, or multi-step sequences where terseness risks misreading.",
  ].join("\n"),
  // Compress the SCOPE: normal grammar, but answer only what was asked.
  crossquestion: [
    "ANSWER MODE (persistent, apply to this reply): the user is cross-questioning you.",
    "Answer ONLY the question asked, in the shortest form that fully answers it —",
    "one word, one line, or one short paragraph. Plain readable grammar.",
    "No suggestions, no next steps, no offers, no restating the question, no extra",
    "context beyond the answer. Cite file:line when referencing code.",
    "Exception — use normal full prose for security warnings or irreversible-action",
    "confirmations.",
  ].join("\n"),
};

/** Wire text for an outgoing message: unchanged when no style, instruction appended when active. */
export function wrapPrompt(text: string, style: ReplyStyle | null): string {
  return style ? `${text}\n\n${INSTRUCTIONS[style]}` : text;
}

/** Next active style after requesting one: same again turns it off, different switches. */
export function toggleStyle(current: ReplyStyle | null, requested: ReplyStyle): ReplyStyle | null {
  return current === requested ? null : requested;
}
```

2. Delete `src/domain/caveman.ts` and `tests/domain/caveman.test.ts` (`rm` both).
3. Create `tests/domain/reply-style.test.ts` importing
   `{ INSTRUCTIONS, wrapPrompt, toggleStyle }` from
   `../../src/domain/reply-style.ts` (import/describe style of
   `tests/domain/caveman.test.ts` before deletion) asserting:
   - `wrapPrompt("hi", null)` returns exactly `"hi"`.
   - `wrapPrompt("hi", "caveman")` starts with `"hi\n\n"` and contains `INSTRUCTIONS.caveman`.
   - `wrapPrompt("hi", "crossquestion")` contains `INSTRUCTIONS.crossquestion` and not the word `"caveman-terse"`.
   - `toggleStyle(null, "caveman")` → `"caveman"`.
   - `toggleStyle("caveman", "caveman")` → `null`.
   - `toggleStyle("caveman", "crossquestion")` → `"crossquestion"`.

**Verify:**
```bash
bun test tests/domain/reply-style.test.ts
# Expected: all tests pass, 0 fail
```

**Out of scope:** commands.ts, app.tsx (they still reference caveman.ts and will
be broken until Tasks 2–3 — expected mid-refactor; do not "fix" them here).

## Task 2: Rework commands.ts to setReplyStyle + add /crossquestion + tests

**Depends on:** Task 1
**Files:**
- Modify: `src/domain/commands.ts` — swap `toggleCaveman` for `setReplyStyle`, rework `/caveman`, add `/crossquestion`
- Modify: `tests/domain/commands.test.ts` — update stub, extend the caveman describe block

**Steps:**
1. In `src/domain/commands.ts`, add after the existing imports:
   `import type { ReplyStyle } from "./reply-style.ts";`
2. In `CommandCtx`, replace the `toggleCaveman` member (both doc comment and
   signature) with:
```ts
  /** toggle/switch the active reply style; returns the new active style (null = off) */
  setReplyStyle: (style: ReplyStyle) => ReplyStyle | null;
```
3. Replace the whole `/caveman` command entry with these two entries (same
   position, after `ask`, before `usage`):
```ts
  {
    name: "caveman",
    description: "toggle terse caveman-style replies",
    run: (_args, ctx) => {
      const now = ctx.setReplyStyle("caveman");
      ctx.print(now === "caveman" ? "caveman mode on — replies will be terse" : "caveman mode off");
    },
  },
  {
    name: "crossquestion",
    description: "toggle quick direct answers for cross-questioning",
    run: (_args, ctx) => {
      const now = ctx.setReplyStyle("crossquestion");
      ctx.print(now === "crossquestion" ? "crossquestion mode on — quick direct answers" : "crossquestion mode off");
    },
  },
```
4. In `tests/domain/commands.test.ts`: add
   `import type { ReplyStyle } from "../../src/domain/reply-style.ts";` and in
   `stubCtx()` replace the two lines
   `caveman: false,` / `toggleCaveman: () => { ... },` with:
```ts
    style: null as ReplyStyle | null,
    setReplyStyle: (s: ReplyStyle) => { ctx.style = ctx.style === s ? null : s; return ctx.style; },
```
   (also change the `stubCtx` return-type annotation's extras if it lists
   `caveman` — it does not; only the object literal changes).
5. Replace the existing `describe("/caveman command", ...)` block with:
```ts
describe("reply-style commands", () => {
  test("/caveman toggles on then off", () => {
    const ctx = stubCtx();
    dispatchCommand("/caveman", ctx, COMMANDS);
    dispatchCommand("/caveman", ctx, COMMANDS);
    expect(ctx.prints[0]).toContain("caveman mode on");
    expect(ctx.prints[1]).toContain("caveman mode off");
  });

  test("/crossquestion toggles on then off", () => {
    const ctx = stubCtx();
    dispatchCommand("/crossquestion", ctx, COMMANDS);
    dispatchCommand("/crossquestion", ctx, COMMANDS);
    expect(ctx.prints[0]).toContain("crossquestion mode on");
    expect(ctx.prints[1]).toContain("crossquestion mode off");
  });

  test("activating one style replaces the other", () => {
    const ctx = stubCtx();
    dispatchCommand("/caveman", ctx, COMMANDS);
    dispatchCommand("/crossquestion", ctx, COMMANDS);
    expect(ctx.prints[1]).toContain("crossquestion mode on");
    expect(ctx.style).toBe("crossquestion");
  });
});
```

**Verify:**
```bash
bun test tests/domain/commands.test.ts
# Expected: all tests pass, 0 fail
```

**Out of scope:** app.tsx (Task 3), reply-style.ts changes.

## Task 3: Rewire app.tsx to the single reply-style state

**Depends on:** Tasks 1–2
**Files:**
- Modify: `src/ui/app.tsx` — swap the caveman import/state/ctx for reply-style
- Copy from (precedent): `src/ui/app.tsx` — the existing caveman wiring being replaced

**Steps:**
1. Replace `import { wrapPrompt } from "../domain/caveman.ts";` with
   `import { wrapPrompt, toggleStyle, type ReplyStyle } from "../domain/reply-style.ts";`
2. Replace `const [caveman, setCaveman] = useState(false); // /caveman terse-reply mode, session-only`
   with `const [replyStyle, setReplyStyle] = useState<ReplyStyle | null>(null); // /caveman | /crossquestion, session-only`
3. In the `send` helper, change `wrapPrompt(wire, caveman)` to `wrapPrompt(wire, replyStyle)`.
4. In `ctx`, replace the `toggleCaveman` entry with:
```ts
    setReplyStyle: (style: ReplyStyle) => {
      const next = toggleStyle(replyStyle, style);
      setReplyStyle(next);
      return next;
    },
```
5. If any other file still references `caveman.ts` (`grep -rn "caveman" src/`),
   STOP and report — only app.tsx, commands.ts, and reply-style.ts should mention it.

**Verify:**
```bash
bun test
# Expected: full suite passes, 0 fail
bunx tsc --noEmit
# Expected: exactly the 2 pre-existing errors (scripts/title-probe.ts, tests/domain/commands.test.ts) — nothing new
```
Then manual (untestable OpenTUI rendering, per CLAUDE.md): run `bun run start`;
`/crossquestion` → "crossquestion mode on — quick direct answers"; ask a short
question, confirm a short answer and a clean transcript; `/caveman` → switches;
`/caveman` again → off.

**Out of scope:** persistence, footer indicator, /ask path, per-message variants.
