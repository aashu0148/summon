import type { Theme } from "./theme.ts";
import type { StyleDefinitionInput } from "@opentui/core";

// Scope → style map consumed by SyntaxStyle for the <markdown> renderable. OpenTUI's
// MarkdownRenderable tags every inline/block chunk with one of these scope names;
// anything we don't register falls back to "default". Every color is derived from the
// active theme so rendered markdown re-tints with /theme like the rest of the transcript.
//
// Kept pure (no @opentui native import) so it's unit-testable; markdown-style.ts turns
// this spec into the actual native SyntaxStyle.
export function markdownStyleSpec(t: Theme): Record<string, StyleDefinitionInput> {
  return {
    default: { fg: t.ink }, // body text
    "markup.heading": { fg: t.accent, bold: true },
    "markup.strong": { fg: t.ink, bold: true },
    "markup.italic": { fg: t.ink, italic: true },
    "markup.strikethrough": { fg: t.muted, dim: true },
    "markup.raw": { fg: t.sys }, // inline `code` and fenced code blocks
    "markup.quote": { fg: t.muted, italic: true },
    "markup.list": { fg: t.accentDim }, // bullet / number markers
    "markup.link.label": { fg: t.user, underline: true },
    "markup.link.url": { fg: t.muted },
    "markup.link": { fg: t.muted }, // surrounding "(", ")" glyphs
  };
}

// Block-level markdown tokens whose content has an intrinsic width and must NOT soft-wrap
// (tables, fenced code). These get their own horizontal scroll box so wide content can be
// scrolled sideways instead of clipped; prose (everything else) keeps wrapping to width.
export function isOverflowBlock(tokenType: string): boolean {
  return tokenType === "table" || tokenType === "code";
}
