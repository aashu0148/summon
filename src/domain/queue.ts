// Message queue semantics, kept pure so they can be unit-tested without rendering
// the TUI. A message typed (or a skill prompt fired) while Claude is mid-turn is
// held here and sent FIFO as each turn frees up.
//
// `wire` is the text claude actually receives; `display` is the (possibly shorter)
// label shown in the transcript / queue preview; `images` are any pasted image blocks
// sent alongside the text (carried through untouched — the queue logic is text-only).
import type { ImageBlock } from "./content.ts";
export type QueueItem = { wire: string; display: string; images?: ImageBlock[] };

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

// ↑ in an empty composer pulls the newest queued message back out so the user can
// edit or resend it. Pops the TAIL (most recently queued), mirroring shell history.
// Returns null when there's nothing queued.
export function popLast(
  queue: QueueItem[],
): { item: QueueItem; rest: QueueItem[] } | null {
  if (queue.length === 0) return null;
  return { item: queue[queue.length - 1]!, rest: queue.slice(0, -1) };
}

// One-line preview for the queue display: whitespace collapsed, capped in length.
export function previewLine(display: string, max = 72): string {
  const one = display.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max) + "…" : one;
}

// One rendered queue row: a position prefix + the previewed text. `index` is 0-based
// (0 = next to send). The head item gets a "▸" marker and the "next" tag so it's obvious
// which message fires when the current turn finishes; the rest are numbered 2, 3, …
// Numbers are right-aligned to `total`'s width so the previews line up in a column.
export function formatQueueLine(
  display: string,
  index: number,
  total: number,
  max = 72,
): { prefix: string; text: string; head: boolean } {
  const width = String(total).length;
  const n = String(index + 1).padStart(width, " ");
  const head = index === 0;
  return {
    prefix: head ? `${n} ▸ ` : `${n}   `,
    text: previewLine(display, max) + (head ? "   (next)" : ""),
    head,
  };
}
