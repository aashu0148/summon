import type { Theme } from "../theme.ts";

// Header — single composed line so segments can't overlap.
export function Header({ t }: { t: Theme }) {
  return (
    <box backgroundColor={t.panel} paddingLeft={2} border={["bottom"]} borderColor={t.accentDim} flexShrink={0}>
      <text>
        <span fg={t.accent}>▓▒░ SUMMON</span>
      </text>
    </box>
  );
}
