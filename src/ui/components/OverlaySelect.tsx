import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { Theme } from "../theme.ts";
import type { Opt } from "../constants.ts";
import { toggleIndex } from "../../domain/ask.ts";
import { wrapText, scrollOffsetFor } from "../wrap.ts";

type Props = {
  t: Theme;
  title: string;
  options: Opt[];
  onSelect: (opt: Opt | null) => void;
  // Multi-select: Space toggles the highlighted option, Enter confirms all checked ones
  // via onConfirm. Single-select (default) submits the highlighted option on Enter.
  multiSelect?: boolean;
  onConfirm?: (opts: Opt[]) => void;
  // Panel mode: render as a bottom-anchored, height-capped strip beneath the still-visible
  // conversation (used for Claude's AskUserQuestion) instead of a full-height overlay
  // (used for the /model, /theme, /resume pickers).
  panel?: boolean;
};

const INDICATOR = 2; // "▶ " / "  "
const H_CHROME = 5;  // outer paddingLeft(2) + indicator column + right breathing room
const V_CHROME = 8;  // header + title + input + status bar around the overlay

// A select list — shared by the AskUserQuestion prompt (panel mode) and the
// resume/model/theme pickers (full mode). We render it ourselves (instead of OpenTUI's
// <select>) so long option descriptions wrap onto multiple lines instead of being clipped
// at the right edge, and so multi-select checkboxes work. Navigation is handled here; Esc
// is handled by the app-level keyboard handler which dismisses the overlay.
export function OverlaySelect({ t, title, options, onSelect, multiSelect, onConfirm, panel }: Props) {
  const { width, height } = useTerminalDimensions();
  const [sel, setSel] = useState(0);
  const [checked, setChecked] = useState<number[]>([]); // multi-select set (insertion order)
  const [offset, setOffset] = useState(0);

  const mark = INDICATOR + (multiSelect ? 4 : 0); // "▶ " + optional "[x] "
  const descWidth = Math.max(10, width - H_CHROME - mark);
  const wrapped = options.map((o) => wrapText(o.description, descWidth));
  const heights = wrapped.map((lines) => 1 + lines.length + 1); // name + desc + spacer

  useKeyboard((key) => {
    if (key.name === "up" || (key.name === "k" && !key.ctrl)) {
      setSel((s) => (s <= 0 ? options.length - 1 : s - 1));
    } else if (key.name === "down" || (key.name === "j" && !key.ctrl)) {
      setSel((s) => (s >= options.length - 1 ? 0 : s + 1));
    } else if (multiSelect && key.name === "space") {
      setChecked((c) => toggleIndex(c, sel));
    } else if (key.name === "return") {
      if (multiSelect) onConfirm?.(checked.map((i) => options[i]!).filter(Boolean));
      else onSelect(options[sel] ?? null);
    }
  });

  // Panel mode caps the list at roughly half the screen so the conversation above stays
  // readable; full mode uses the whole pane. The row loop below stops at the content end,
  // so short questions never leave empty space.
  const available = panel
    ? Math.max(3, Math.floor(height / 2))
    : Math.max(1, height - V_CHROME);
  const start = scrollOffsetFor(heights, sel, available, offset);
  if (start !== offset) setOffset(start);

  // Render options from the scroll offset until we run out of vertical room.
  const rows: React.ReactNode[] = [];
  let used = 0;
  for (let i = start; i < options.length; i++) {
    if (used + heights[i]! > available && i > start) break;
    used += heights[i]!;
    const isSel = i === sel;
    const box = multiSelect ? (checked.includes(i) ? "[x] " : "[ ] ") : "";
    rows.push(
      <box key={i} flexDirection="column" marginBottom={1} backgroundColor={isSel ? t.panel : t.bg}>
        <text content={`${isSel ? "▶ " : "  "}${box}${options[i]!.name}`} fg={isSel ? t.accent : t.ink} />
        {wrapped[i]!.map((line, j) => (
          <text key={j} content={`  ${line}`} fg={t.muted} />
        ))}
      </box>,
    );
  }

  return (
    <box
      flexGrow={panel ? 0 : 1}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={2}
      paddingTop={1}
      backgroundColor={t.bg}
      border={panel ? ["top"] : undefined}
      borderStyle="heavy"
      borderColor={t.accentDim}
    >
      <text content={title} fg={t.accent} />
      <box flexDirection="column" marginTop={1}>{rows}</box>
    </box>
  );
}
