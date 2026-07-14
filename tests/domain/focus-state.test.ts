import { test, expect } from "bun:test";
import { focusState, markFocus } from "../../src/domain/focus-state.ts";
import { shouldNotify } from "../../src/domain/attention.ts";

// The bug this guards: before any focus event, `live` is false — the state useAttention now
// reads. markFocus is what index.tsx calls from OpenTUI's focus/blur at startup, so the
// notifier isn't blind by the time the first turn completes.
test("starts blind: not live, assumed focused", () => {
  // Fresh module state (this test runs first in the file).
  expect(focusState.live).toBe(false);
  expect(focusState.focused).toBe(true);
});

test("markFocus flips live and tracks the current state", () => {
  markFocus(true);
  expect(focusState.live).toBe(true);
  expect(focusState.focused).toBe(true);

  markFocus(false);
  expect(focusState.live).toBe(true);
  expect(focusState.focused).toBe(false);
});

// The end-to-end intent: once a startup focus-in is seen (live + focused), a completed turn
// must NOT notify. This is the exact case that regressed.
test("focused + live suppresses the nudge; blurred + live fires it", () => {
  markFocus(true);
  expect(shouldNotify(focusState.focused, focusState.live)).toBe(false);

  markFocus(false);
  expect(shouldNotify(focusState.focused, focusState.live)).toBe(true);
});
