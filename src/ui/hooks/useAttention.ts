import { useCallback, useEffect, useRef, useState } from "react";
import { useFocus } from "@opentui/react";
import { attentionMessage, attentionSequence, shouldNotify, type AttentionReason } from "../../domain/attention.ts";
import { sendNotification } from "../../domain/notify.ts";
import { focusState } from "../../domain/focus-state.ts";

// Grace window before we actually nudge, so a quick pane switch inside an IDE (terminal →
// editor and straight back) doesn't fire a notification. Cancelled if focus returns first.
const GRACE_MS = 1500;

/**
 * Attention-seeking glue: tracks terminal focus via OpenTUI's focus/blur events (enabled by
 * writing DECSET 1004 at startup, see index.tsx) and, when a turn finishes or blocks while
 * the user is away, rings the bell + fires a desktop toast. Returns `attention` (drives the
 * tab-title bell icon), `seek(reason, label)` to raise a nudge, and `clear()` to drop it.
 * The pure decision + escape sequences live in domain/attention.ts.
 */
export function useAttention() {
  // null ⇒ no attention. Otherwise the reason, which picks the tab-title icon (✅ done / ❓ blocked).
  const [attention, setAttention] = useState<AttentionReason | null>(null);
  // Focus is tracked in the focusState module, wired to OpenTUI's focus/blur in index.tsx
  // BEFORE React mounts — so the startup focus-in event isn't missed (which used to leave us
  // notifying even while focused). We read it; we don't own it.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
  const clear = useCallback(() => { cancel(); setAttention(null); }, []);
  const fire = (reason: AttentionReason, msg: string) => {
    setAttention(reason); // tab-title icon — stays until the user acts (not cleared on refocus)
    process.stdout.write(attentionSequence(msg)); // bell + OSC 9, for terminals that surface them
    sendNotification("Summon", msg); // the reliable signal: a real OS notification banner
  };

  const seek = useCallback((reason: AttentionReason, label: string) => {
    if (!shouldNotify(focusState.focused, focusState.live)) return; // user's watching — don't nag
    const msg = attentionMessage(reason, label);
    cancel();
    // Without live focus reporting we can't detect a return, so nudge immediately; otherwise
    // wait out the grace window in case they're only glancing away for a moment.
    if (!focusState.live) { fire(reason, msg); return; }
    timerRef.current = setTimeout(() => { timerRef.current = null; if (!focusState.focused) fire(reason, msg); }, GRACE_MS);
  }, []);

  // On refocus, cancel a still-pending grace nudge — the user's back before it fired. (The
  // focusState the decision reads is updated by index.tsx's listener, which runs first.) We
  // deliberately DON'T drop an already-raised bell — the title keeps flagging that the
  // session needs attention until the user actually acts on it (sends / answers).
  useFocus(() => cancel());

  useEffect(() => cancel, []); // drop any pending timer on unmount

  return { attention, seek, clear };
}
