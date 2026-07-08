// Pure text-layout helpers for the custom select overlay. OpenTUI's built-in
// <select> draws each option's description with a single, clipping drawText call
// (fixed 2-line item height), so long descriptions get cut off at the right edge.
// We render the overlay ourselves and wrap descriptions with these helpers.

// Greedy word-wrap into lines no wider than `width`. Words longer than `width`
// are hard-split. Returns [] for empty/whitespace-only text.
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return text.trim() ? [text] : [];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (word.length > width) {
      if (cur) { lines.push(cur); cur = ""; }
      let w = word;
      while (w.length > width) { lines.push(w.slice(0, width)); w = w.slice(width); }
      cur = w;
      continue;
    }
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= width) cur += " " + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Given the rendered line-height of each option, pick the first visible option
// index so the `selected` option stays on screen within `available` rows. Keeps
// the previous offset when possible to avoid jumpy scrolling.
export function scrollOffsetFor(heights: number[], selected: number, available: number, prevOffset: number): number {
  const n = heights.length;
  if (n === 0) return 0;
  let offset = Math.max(0, Math.min(prevOffset, n - 1));
  const sel = Math.max(0, Math.min(selected, n - 1));
  if (sel < offset) offset = sel;
  const heightFrom = (o: number) => {
    let sum = 0;
    for (let i = o; i <= sel; i++) sum += heights[i]!;
    return sum;
  };
  while (offset < sel && heightFrom(offset) > available) offset++;
  return offset;
}
