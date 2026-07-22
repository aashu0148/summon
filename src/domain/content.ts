// Building the stream-json `content` array for an outgoing user message. Kept pure and
// I/O-free so it can be unit-tested: the clipboard read (src/domain/clipboard.ts) turns
// a pasted image into an ImageAttachment, and this module turns text + attachments into
// the block array claude receives over stdin. Image blocks go BEFORE the text block —
// Anthropic's vision guidance recommends image-before-text for best results.

export type ImageAttachment = {
  id: number; // per-message sequence, drives the "[Image #N]" marker
  mediaType: string; // e.g. "image/png"
  data: string; // base64, no data-URI prefix
  bytes: number; // decoded size, for the chip label
};

export type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
export type TextBlock = { type: "text"; text: string };
export type ContentBlock = ImageBlock | TextBlock;

// The inline placeholder shown in the draft (and kept in the transcript label) so the
// user can see an image is attached, mirroring Claude Code's "[Image #1]".
export const imageMarker = (id: number): string => `[Image #${id}]`;

// Chip label for a pending attachment, e.g. "📎 image #1 (12 KB)".
export const attachmentLabel = (a: ImageAttachment): string => {
  const kb = a.bytes < 1024 ? `${a.bytes} B` : `${Math.round(a.bytes / 1024)} KB`;
  return `📎 ${imageMarker(a.id)} (${kb})`;
};

// Turn an attachment into the wire-format image block.
export const toImageBlock = (a: ImageAttachment): ImageBlock => ({
  type: "image",
  source: { type: "base64", media_type: a.mediaType, data: a.data },
});

// Reverse of toImageBlock — a queued message carries wire-format blocks, so when it's
// pulled back into the composer for editing the blocks become attachments again. Ids are
// reassigned 1..n by the caller (they match the "[Image #N]" markers already in the text,
// since attachSeq resets per message); bytes is recomputed from the base64 length.
export const fromImageBlock = (b: ImageBlock, id: number): ImageAttachment => {
  const d = b.source.data;
  const padding = d.endsWith("==") ? 2 : d.endsWith("=") ? 1 : 0;
  return { id, mediaType: b.source.media_type, data: d, bytes: (d.length / 4) * 3 - padding };
};

// Compose the content array: images first, then a text block only when non-empty.
// Returns [] when there's nothing to send (caller should skip the write).
export function buildUserContent(text: string, images: ImageBlock[] = []): ContentBlock[] {
  const blocks: ContentBlock[] = [...images];
  if (text) blocks.push({ type: "text", text });
  return blocks;
}
