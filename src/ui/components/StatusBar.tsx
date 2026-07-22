import type { Theme } from "../theme.ts";
import { CWD, GIT_BRANCH } from "../constants.ts";
import { fmtTok } from "../../lib/format.ts";
import type { Usage } from "../../session/claude-session.ts";

type Props = {
  t: Theme;
  model: string;
  sessionTok: Usage;
  cost: number;
};

// Status bar — single composed line: cwd · model · session tokens · est. cost.
export function StatusBar({ t, model, sessionTok, cost }: Props) {
  return (
    <box backgroundColor={t.panel} paddingLeft={2} border={["top"]} borderColor={t.accentDim} flexShrink={0}>
      <text>
        <span fg={t.muted}>{CWD + "  "}</span>
        {GIT_BRANCH ? <span fg={t.accent}>{`⎇ ${GIT_BRANCH}`}</span> : null}
        <span fg={t.muted}>{"  ·  "}</span>
        <span fg={t.accent}>{model}</span>
        <span fg={t.muted}>{`  ·  ↑${fmtTok(sessionTok.input)} ↓${fmtTok(sessionTok.output)}  ·  ~$${cost.toFixed(4)}`}</span>
      </text>
    </box>
  );
}
