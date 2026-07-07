import type { Theme } from "../theme.ts";
import type { Opt } from "../constants.ts";

type Props = {
  t: Theme;
  title: string;
  options: Opt[];
  onSelect: (opt: Opt | null) => void;
};

// A full-height select overlay — shared by the AskUserQuestion prompt and the
// resume/model/theme pickers.
export function OverlaySelect({ t, title, options, onSelect }: Props) {
  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingTop={1} backgroundColor={t.bg}>
      <text content={title} fg={t.accent} />
      <select
        focused
        flexGrow={1}
        marginTop={1}
        options={options}
        showDescription
        wrapSelection
        onSelect={(_i: number, opt: any) => onSelect(opt)}
        backgroundColor={t.bg}
        textColor={t.ink}
        focusedBackgroundColor={t.bg}
        focusedTextColor={t.ink}
        selectedBackgroundColor={t.panel}
        selectedTextColor={t.accent}
        descriptionColor={t.muted}
        selectedDescriptionColor={t.muted}
      />
    </box>
  );
}
