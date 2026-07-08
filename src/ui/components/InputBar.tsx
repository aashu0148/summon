import { useEffect, type RefObject } from "react";
import type { Theme } from "../theme.ts";
import { INPUT_KEYBINDINGS } from "../constants.ts";

type Props = {
  t: Theme;
  busy: boolean;
  spin: string;
  focused: boolean;
  inputKey: number;
  inputInit: string;
  taRef: RefObject<any>;
  onDraft: (value: string) => void;
  onSubmit: (value: string) => void;
};

// The main input — a textarea so long text / pastes wrap to multiple lines (grows up to
// 6 rows, then scrolls). Enter submits, Shift+Enter inserts a newline.
export function InputBar({ t, busy, spin, focused, inputKey, inputInit, taRef, onDraft, onSubmit }: Props) {
  // The input is remounted (inputKey bump) to programmatically refill it — after a file
  // mention, a /command completion, an image paste, or ↑/↓ history recall. A fresh mount
  // parks the cursor at offset 0; move it to the end so the user keeps typing where the
  // text ends, not before it.
  useEffect(() => {
    const ta = taRef.current;
    if (ta) ta.cursorOffset = (ta.plainText ?? "").length;
  }, [inputKey]);

  return (
    <box backgroundColor={t.panel} paddingLeft={1} paddingRight={1} border={["top"]} borderColor={t.accentDim} flexShrink={0} flexDirection="row">
      <text content={busy ? ` ${spin} ` : " › "} fg={t.accent} />
      <textarea
        key={inputKey}
        ref={taRef}
        initialValue={inputInit}
        focused={focused}
        flexGrow={1}
        minHeight={1}
        maxHeight={6}
        wrapMode="word"
        keyBindings={INPUT_KEYBINDINGS}
        onContentChange={() => onDraft(taRef.current?.plainText ?? "")}
        onSubmit={() => onSubmit(taRef.current?.plainText ?? "")}
        placeholder={busy ? "waiting for claude…  (commands still work)" : "type a message, or /help"}
        placeholderColor={t.muted}
        backgroundColor={t.panel}
        focusedBackgroundColor={t.panel}
        textColor={t.ink}
        focusedTextColor={t.ink}
      />
    </box>
  );
}
