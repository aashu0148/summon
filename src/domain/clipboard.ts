import { $ } from "bun";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ImageAttachment } from "./content.ts";

// Reading an image off the macOS clipboard. Real terminals don't deliver image bytes on
// Cmd+V (bracketed paste is text-only), so — like Claude Code — we go straight to the OS
// clipboard via osascript, coercing whatever's there to PNG («class PNGf»). This is the
// side-effecting edge; the pure block-building lives in ./content.ts.

// AppleScript: coerce the clipboard to PNG and write it to `outFile`. Prints "OK" on
// success, "NOIMAGE" when the clipboard holds no image (the coercion throws).
const script = (outFile: string) => `
set outFile to "${outFile}"
try
  set pngData to (the clipboard as «class PNGf»)
on error
  return "NOIMAGE"
end try
set fh to open for access (POSIX file outFile) with write permission
set eof fh to 0
write pngData to fh
close access fh
return "OK"`;

// Returns the clipboard image (id assigned by the caller/composer), or null when there's
// no image — or on any failure, so a failed paste is silent, not fatal.
export async function readClipboardImage(): Promise<Omit<ImageAttachment, "id"> | null> {
  if (process.platform !== "darwin") return null; // clipboard read is macOS-only for now
  const out = join(tmpdir(), `summon-clip-${process.pid}-${Date.now()}.png`);
  try {
    const res = (await $`osascript -e ${script(out)}`.quiet().text()).trim();
    if (res !== "OK") return null;
    const file = Bun.file(out);
    const buf = new Uint8Array(await file.arrayBuffer());
    if (!buf.length) return null;
    return { mediaType: "image/png", data: Buffer.from(buf).toString("base64"), bytes: buf.length };
  } catch {
    return null;
  } finally {
    try { await $`rm -f ${out}`.quiet(); } catch {}
  }
}
