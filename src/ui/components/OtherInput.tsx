import type { Theme } from "../theme.ts";
import type { AskQuestion } from "../../session/claude-session.ts";

type Props = { t: Theme; askQ: AskQuestion; onSubmit: (value: string) => void };

// Free-text entry for the "Other…" answer to an AskUserQuestion prompt.
export function OtherInput({ t, askQ, onSubmit }: Props) {
  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingTop={1} backgroundColor={t.bg}>
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
