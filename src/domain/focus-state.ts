// Terminal focus state, tracked from OpenTUI's focus/blur events. It lives in a plain module
// (not React state) on purpose: index.tsx must start tracking SYNCHRONOUSLY at startup —
// before React mounts — to catch the focus-in event the terminal fires the instant the app
// launches (verified: OpenTUI emits it ~12ms after createCliRenderer). useAttention subscribes
// via useEffect, which runs too late to see that first event; if it relied only on its own
// subscription it would start "blind" (live=false) and, per shouldNotify, notify even while
// the terminal is focused. Seeding the notify decision from here is what fixes that.
//
// `live`  — has ANY focus event ever fired? false ⇒ the terminal can't report focus (e.g.
//           macOS Terminal.app), so shouldNotify errs toward notifying.
// `focused` — the current state; assume focused until told otherwise.
export const focusState: { live: boolean; focused: boolean } = { live: false, focused: true };

export function markFocus(focused: boolean): void {
  focusState.live = true;
  focusState.focused = focused;
}
