import type { Theme } from "../theme.ts";
import { LABEL_TEXT, labelFg, bodyFg, groupTurns, type Turn } from "../constants.ts";

type Props = {
  t: Theme;
  turns: Turn[];
  streaming: string;
  thinking: string;
  busy: boolean;
  spin: string;
  activity: string;
  hud: string;
};

// The conversation transcript — past turns, the in-flight thinking/answer blocks, and a
// single always-on status line while a turn runs. Sticky-scrolled to the bottom.
export function Conversation({ t, turns, streaming, thinking, busy, spin, activity, hud }: Props) {
  return (
    <scrollbox flexGrow={1} flexShrink={1} minHeight={0} paddingLeft={2} paddingTop={1} backgroundColor={t.bg} stickyScroll stickyStart="bottom">
      {turns.length === 0 && !streaming && !thinking ? (
        <text content="Ask anything. Enter to send · /help for commands · Ctrl+C to quit." fg={t.muted} />
      ) : null}
      {groupTurns(turns).map((group, i) => (
        <box key={i} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
          <text content={LABEL_TEXT[group.role]} fg={labelFg(t, group.role)} />
          {group.texts.map((text, j) => (
            <text key={j} content={text} fg={bodyFg(t, group.role)} marginTop={j === 0 ? 0 : 1} />
          ))}
        </box>
      ))}
      {thinking ? (
        <box flexDirection="column" marginTop={turns.length ? 1 : 0}>
          <text content="THINKING" fg={t.sys} />
          <text content={thinking} fg={t.muted} />
        </box>
      ) : null}
      {streaming ? (
        // Continuation of the current Claude group (e.g. a reply after a tool call)
        // reuses the header above instead of flashing a fresh CLAUDE label that would
        // then vanish when this stream commits and merges into the group.
        <box
          flexDirection="column"
          marginTop={turns[turns.length - 1]?.role === "claude" ? 1 : turns.length || thinking ? 1 : 0}
        >
          {turns[turns.length - 1]?.role === "claude" ? null : <text content="CLAUDE" fg={t.accent} />}
          <text content={streaming + "▌"} fg={t.ink} />
        </box>
      ) : null}
      {/* one always-on status line while busy — spinner + what claude is doing right
          now (current tool, else responding/thinking) + live tokens + how to stop.
          Keeps the user out of the dark even when there's no thinking/answer text. */}
      {busy ? (
        <box marginTop={turns.length || thinking || streaming ? 1 : 0}>
          <text
            content={`${spin} ${streaming ? "responding…" : activity || "thinking…"}  ·  ${hud}  ·  Esc to interrupt`}
            fg={t.accentDim}
          />
        </box>
      ) : null}
    </scrollbox>
  );
}
