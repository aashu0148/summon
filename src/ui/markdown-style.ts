import { SyntaxStyle, ScrollBoxRenderable } from "@opentui/core";
import type { MarkdownOptions } from "@opentui/core";
import type { Theme } from "./theme.ts";
import { markdownStyleSpec, isOverflowBlock } from "./markdown-theme.ts";

// SyntaxStyle allocates native (zig) resources and never changes for a given theme, so
// we build one per theme name and reuse it for the process lifetime — at most one per
// palette — instead of re-creating it on every render or /theme switch.
const cache = new Map<string, SyntaxStyle>();

export function markdownStyle(t: Theme): SyntaxStyle {
  let style = cache.get(t.name);
  if (!style) {
    style = SyntaxStyle.fromStyles(markdownStyleSpec(t));
    cache.set(t.name, style);
  }
  return style;
}

// <markdown> renderNode hook: wraps wide, non-wrapping blocks (tables, fenced code) in a
// horizontally-scrollable box so they can be scrolled sideways (trackpad / shift-wheel)
// instead of being clipped, while prose keeps wrapping to the transcript width. Returning
// undefined falls back to default (wrapping) rendering. focusable:false keeps these out of
// the tab order — mouse/trackpad still scrolls them.
export const overflowScrollRenderNode: MarkdownOptions["renderNode"] = (token, ctx) => {
  if (!isOverflowBlock(token.type)) return undefined;
  const inner = ctx.defaultRender();
  if (!inner) return null;
  const box = new ScrollBoxRenderable(inner.ctx, { scrollX: true, scrollY: false, focusable: false });
  box.add(inner);
  return box;
};
