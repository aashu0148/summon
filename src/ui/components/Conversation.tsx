import { useRenderer } from "@opentui/react";
import { TextAttributes } from "@opentui/core";

import type { Theme } from "../theme.ts";
import { LABEL_TEXT, labelFg, bodyFg, groupTurns, type Turn } from "../constants.ts";
import { markdownStyle } from "../markdown-style.ts";
import { shouldStartSelection } from "../../domain/clipboard.ts";

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
  // Claude's replies arrive as markdown; render them formatted (headings, bold, code
  // blocks, lists…) via OpenTUI's markdown renderable, tinted with the active theme.
  // conceal hides the raw ** ` # markers; other roles stay plain text.
  const md = markdownStyle(t);
  const renderer = useRenderer();
  return (
    <scrollbox
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      backgroundColor={t.bg}
      stickyScroll
      stickyStart="bottom"
      // Make the scrollbox's content box selectable so a drag can anchor a selection on it;
      // the renderer then walks its (selectable) text children to build the copied text.
      contentOptions={{ selectable: true } as any}
      // Drag to highlight transcript text (then Ctrl+C copies it — see app.tsx). OpenTUI's
      // automatic selection never starts here because the content box wins the hit-test and
      // boxes report shouldStartSelection=false, so we begin it by hand; the renderer then
      // extends the drag and finalizes on release on its own.
      onMouseDown={(e: any) => {
        if (shouldStartSelection(e?.target)) renderer?.startSelection(e.target, e.x, e.y);
      }}
    >
      {turns.length === 0 && !streaming && !thinking ? (
        <text content="Ask anything. Enter to send · /help for commands · Ctrl+C to quit." fg={t.muted} />
      ) : null}
      {/* Tool-call trace rows ("→ Read src/foo.ts") are hidden for now — they added a lot
          of bulk to the transcript. The ephemeral "what claude is doing" status line below
          still covers this. To bring them back, drop the `.filter(...)`. */}
      {groupTurns(turns.filter((turn) => turn.role !== "tool")).map((group, i) =>
        group.role === "you" ? (
          // User messages get an opencode-style treatment: a colored accent bar on the
          // left and a shaded background, instead of a "YOU" label. The bar and tint both
          // track the active theme.
          <box
            key={i}
            flexDirection="column"
            marginTop={i === 0 ? 0 : 1}
            border={["left"]}
            borderStyle="heavy"
            borderColor={t.user}
            backgroundColor={t.userBg}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
          >
            <text content={LABEL_TEXT.you} fg={t.user} />
            {group.texts.map((text, j) => (
              <text key={j} content={text} fg={t.ink} attributes={TextAttributes.DIM} marginTop={1} />
            ))}
          </box>
        ) : (
          <box key={i} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
            <text content={LABEL_TEXT[group.role]} fg={labelFg(t, group.role)} />
            {group.texts.map((text, j) =>
              group.role === "claude" ? (
                <markdown key={j} content={text} syntaxStyle={md} fg={t.ink} conceal marginTop={j === 0 ? 0 : 1} />
              ) : (
                <text key={j} content={text} fg={bodyFg(t, group.role)} marginTop={j === 0 ? 0 : 1} />
              ),
            )}
          </box>
        ),
      )}
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
          {/* streaming: keep the trailing block unstable so partial markdown (e.g. an
              unclosed code fence) reflows as more text arrives. The busy line below is
              the liveness cue, so no block cursor here. */}
          <markdown content={streaming} syntaxStyle={md} fg={t.ink} conceal streaming />
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
