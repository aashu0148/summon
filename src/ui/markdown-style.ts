import { SyntaxStyle } from "@opentui/core";
import type { Theme } from "./theme.ts";
import { markdownStyleSpec } from "./markdown-theme.ts";

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
