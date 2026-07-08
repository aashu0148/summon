import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { Theme } from "../theme.ts";
import type { Opt } from "../constants.ts";
import { wrapText, scrollOffsetFor } from "../wrap.ts";

type Props = {
  t: Theme;
  title: string;
  options: Opt[];
  onSelect: (opt: Opt | null) => void;
};

const INDICATOR = 2; // "▶ " / "  "
const H_CHROME = 5;  // outer paddingLeft(2) + indicator column + right breathing room
const V_CHROME = 8;  // header + title + input + status bar around the overlay

// A full-height select overlay — shared by the AskUserQuestion prompt and the
// resume/model/theme pickers. We render it ourselves (instead of OpenTUI's
// <select>) so long option descriptions wrap onto multiple lines instead of
// being clipped at the right edge. Navigation is handled here; Esc is handled
// by the app-level keyboard handler which dismisses the overlay.
export function OverlaySelect({ t, title, options, onSelect }: Props) {
  const { width, height } = useTerminalDimensions();
  const [sel, setSel] = useState(0);
  const [offset, setOffset] = useState(0);

  const descWidth = Math.max(10, width - H_CHROME - INDICATOR);
  const wrapped = options.map((o) => wrapText(o.description, descWidth));
  const heights = wrapped.map((lines) => 1 + lines.length + 1); // name + desc + spacer

  useKeyboard((key) => {
    if (key.name === "up" || (key.name === "k" && !key.ctrl)) {
      setSel((s) => (s <= 0 ? options.length - 1 : s - 1));
    } else if (key.name === "down" || (key.name === "j" && !key.ctrl)) {
      setSel((s) => (s >= options.length - 1 ? 0 : s + 1));
    } else if (key.name === "return") {
      onSelect(options[sel] ?? null);
    }
  });

  const available = Math.max(1, height - V_CHROME);
  const start = scrollOffsetFor(heights, sel, available, offset);
  if (start !== offset) setOffset(start);

  // Render options from the scroll offset until we run out of vertical room.
  const rows: React.ReactNode[] = [];
  let used = 0;
  for (let i = start; i < options.length; i++) {
    if (used + heights[i]! > available && i > start) break;
    used += heights[i]!;
    const isSel = i === sel;
    rows.push(
      <box key={i} flexDirection="column" marginBottom={1} backgroundColor={isSel ? t.panel : t.bg}>
        <text content={`${isSel ? "▶ " : "  "}${options[i]!.name}`} fg={isSel ? t.accent : t.ink} />
        {wrapped[i]!.map((line, j) => (
          <text key={j} content={`  ${line}`} fg={t.muted} />
        ))}
      </box>,
    );
  }

  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingTop={1} backgroundColor={t.bg}>
      <text content={title} fg={t.accent} />
      <box flexDirection="column" marginTop={1}>{rows}</box>
    </box>
  );
}
