// Message queue semantics, kept pure so they can be unit-tested without rendering
// the TUI. A message typed (or a skill prompt fired) while Claude is mid-turn is
// held here and sent FIFO as each turn frees up.
//
// `wire` is the text claude actually receives; `display` is the (possibly shorter)
// label shown in the transcript / queue preview.
export type QueueItem = { wire: string; display: string };

// Where should an outgoing message go right now? If a turn is in flight it must
// wait its turn; otherwise it sends immediately.
export function routeMessage(
  busy: boolean,
  item: QueueItem,
): { action: "send" | "queue"; item: QueueItem } {
  return { action: busy ? "queue" : "send", item };
}

// Append to the tail — FIFO.
export function enqueue(queue: QueueItem[], item: QueueItem): QueueItem[] {
  return [...queue, item];
}

// Pull the next item when a turn finishes. Returns null while still busy or when
// the queue is empty, so callers can `if (!d) return;` in a drain effect.
export function drain(
  busy: boolean,
  queue: QueueItem[],
): { next: QueueItem; rest: QueueItem[] } | null {
  if (busy || queue.length === 0) return null;
  return { next: queue[0]!, rest: queue.slice(1) };
}

// One-line preview for the queue display: whitespace collapsed, capped in length.
export function previewLine(display: string, max = 72): string {
  const one = display.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max) + "…" : one;
}
