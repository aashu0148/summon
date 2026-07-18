import type { Theme } from "../theme.ts";
import type { AskQuestion } from "../../session/claude-session.ts";

type Props = { t: Theme; askQ: AskQuestion; onSubmit: (value: string) => void; panel?: boolean };

// Free-text entry for the "Other…" answer to an AskUserQuestion prompt. Panel mode renders
// as a bottom strip beneath the still-visible conversation (see OverlaySelect).
export function OtherInput({ t, askQ, onSubmit, panel }: Props) {
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
      <text content={`${askQ.header ? askQ.header + " · " : ""}${askQ.question}  · type your answer · Enter to submit · Esc to go back`} fg={t.accent} />
      <box marginTop={1} flexDirection="row">
        <text content=" › " fg={t.accent} />
        <input
          focused
          flexGrow={1}
          onSubmit={(v: any) => onSubmit(v)}
          placeholder="your answer"
          placeholderColor={t.muted}
          backgroundColor={t.bg}
          focusedBackgroundColor={t.bg}
          textColor={t.ink}
          focusedTextColor={t.ink}
        />
      </box>
    </box>
  );
}
