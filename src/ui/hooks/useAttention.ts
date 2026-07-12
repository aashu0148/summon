import { useCallback, useEffect, useRef, useState } from "react";
import { useBlur, useFocus } from "@opentui/react";
import { attentionMessage, attentionSequence, shouldNotify, type AttentionReason } from "../../domain/attention.ts";
import { sendNotification } from "../../domain/notify.ts";

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
  const focusedRef = useRef(true); // assume focused until the terminal tells us otherwise
  const liveRef = useRef(false); // has focus reporting ever fired? false ⇒ terminal can't report (e.g. Terminal.app)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
  const clear = useCallback(() => { cancel(); setAttention(null); }, []);
  const fire = (reason: AttentionReason, msg: string) => {
    setAttention(reason); // tab-title icon — stays until the user acts (not cleared on refocus)
    process.stdout.write(attentionSequence(msg)); // bell + OSC 9, for terminals that surface them
    sendNotification("Summon", msg); // the reliable signal: a real OS notification banner
  };

  const seek = useCallback((reason: AttentionReason, label: string) => {
    if (!shouldNotify(focusedRef.current, liveRef.current)) return; // user's watching — don't nag
    const msg = attentionMessage(reason, label);
    cancel();
    // Without live focus reporting we can't detect a return, so nudge immediately; otherwise
    // wait out the grace window in case they're only glancing away for a moment.
    if (!liveRef.current) { fire(reason, msg); return; }
    timerRef.current = setTimeout(() => { timerRef.current = null; if (!focusedRef.current) fire(reason, msg); }, GRACE_MS);
  }, []);

  // Any focus/blur event proves the terminal reports focus, so we can start trusting it.
  // On refocus we cancel a still-pending grace nudge and stop treating the user as away, but
  // we deliberately DON'T drop an already-raised bell — the title keeps flagging that the
  // session needs attention until the user actually acts on it (sends / answers).
  useFocus(() => { liveRef.current = true; focusedRef.current = true; cancel(); });
  useBlur(() => { liveRef.current = true; focusedRef.current = false; });

  useEffect(() => cancel, []); // drop any pending timer on unmount

  return { attention, seek, clear };
}
