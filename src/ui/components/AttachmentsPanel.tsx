import type { Theme } from "../theme.ts";
import { attachmentLabel, type ImageAttachment } from "../../domain/content.ts";

type Props = { t: Theme; attachments: ImageAttachment[] };

// Pending pasted images shown above the input, so it's clear what will be sent with the
// next message. Cleared on submit. Render-only.
export function AttachmentsPanel({ t, attachments }: Props) {
  if (!attachments.length) return null;
  return (
    <box backgroundColor={t.bg} paddingLeft={3} flexDirection="row" flexShrink={0}>
      <text content={attachments.map(attachmentLabel).join("   ")} fg={t.accentDim} />
    </box>
  );
}
