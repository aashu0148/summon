import { t as styled, fg as fgChunk } from "@opentui/core";
import type { Theme } from "../theme.ts";
import { formatCommandHint, type Command } from "../../domain/commands.ts";

type Props = {
  t: Theme;
  fileHints: string[];
  fileSel: number;
  hints: Command[];
  cmdSel: number;
  hasOverlay: boolean;
  hasAsk: boolean;
};

// Autocomplete suggestions below the transcript: @-mention file paths, else /command
// and skill matches. Only one shows at a time; hidden while an overlay/ask owns the UI.
export function HintsPanel({ t, fileHints, fileSel, hints, cmdSel, hasOverlay, hasAsk }: Props) {
  if (fileHints.length && !hasOverlay && !hasAsk) {
    // @-mention file suggestions — Tab completes the first (▸-marked) one.
    return (
      <box backgroundColor={t.bg} paddingLeft={3} flexDirection="column" flexShrink={0}>
        {fileHints.map((f, i) => (
          <text key={f} content={(i === fileSel ? "▸ " : "  ") + "@" + f} fg={i === fileSel ? t.accent : t.muted} />
        ))}
        <text content="  ↑↓ to choose · Tab/Enter to complete · Esc to dismiss" fg={t.accentDim} />
      </box>
    );
  }
  if (hints.length && !hasOverlay) {
    // /command · skill suggestions — ▸ marks the highlighted one.
    return (
      <box backgroundColor={t.bg} paddingLeft={3} flexDirection="column" flexShrink={0}>
        {hints.map((c, i) => {
          // One StyledText node per line — a single `content` child. Mapping a
          // `<text>` with multiple `<span>` children corrupts the render (adjacent
          // rows get zipped/dropped), so we build the two-tone line as chunks.
          const { label, desc } = formatCommandHint(c, i === cmdSel);
          return (
            <text
              key={c.name}
              content={styled`${fgChunk(i === cmdSel ? t.accent : t.muted)(label)}${fgChunk(t.accentDim)(desc)}`}
            />
          );
        })}
        <text content="  ↑↓ to choose · Tab/Enter to complete · Esc to dismiss" fg={t.accentDim} />
      </box>
    );
  }
  return null;
}
