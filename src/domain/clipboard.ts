import { $ } from "bun";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ImageAttachment } from "./content.ts";

/**
 * Whether a mousedown on `target` should manually begin a text selection.
 *
 * OpenTUI auto-starts a mouse selection only when the hit renderable's shouldStartSelection()
 * returns true — which BoxRenderable never does (it inherits the base "return false"). In our
 * transcript the scrollbox's content *box* wins the hit-test (it shadows its text children in
 * the hit grid), so the automatic path never fires and drag-to-select produced nothing — which
 * is why Ctrl+C always fell through to quit. The box is still `selectable`, so we start the
 * selection ourselves (renderer.startSelection skips the shouldStartSelection check) and let the
 * renderer extend it on drag and finalize on mouseup. Pure so the gate is unit-tested without a
 * live renderer.
 */
export function shouldStartSelection(target: { selectable?: boolean } | null | undefined): boolean {
  return Boolean(target?.selectable);
}

/**
 * The clipboard-write commands to try, in order, for a platform. Each reads the text on
 * stdin and sets the OS clipboard. We shell out to the native tool rather than rely on the
 * terminal's OSC52 support, which macOS Terminal.app (and tmux/ssh without extra config)
 * silently drop — that was why Ctrl+C "copied" but nothing landed. Linux has several
 * possibilities depending on X11/Wayland, so we return candidates and use the first that
 * succeeds. Pure (platform in → command list out) so the mapping is unit-tested.
 */
export function clipboardCommands(platform: NodeJS.Platform): string[][] {
  if (platform === "darwin") return [["pbcopy"]];
  if (platform === "win32") return [["clip"]];
  // Linux/BSD: Wayland first, then X11 tools, whichever is installed.
  return [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];
}

/**
 * Write text to the OS clipboard via the platform's native tool. Returns true on the first
 * command that exits 0, false if none is available/succeeds (caller can fall back to OSC52).
 */
export async function writeClipboard(text: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  for (const cmd of clipboardCommands(platform)) {
    try {
      const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      proc.stdin.write(text);
      await proc.stdin.end();
      if ((await proc.exited) === 0) return true;
    } catch {
      // command not found / not executable — try the next candidate
    }
  }
  return false;
}

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
