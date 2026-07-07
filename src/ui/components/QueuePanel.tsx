import { t as styled, fg as fgChunk } from "@opentui/core";
import type { Theme } from "../theme.ts";
import { formatQueueLine, type QueueItem } from "../../domain/queue.ts";

type Props = { t: Theme; queue: QueueItem[] };

// Queued messages — typed while Claude was busy, sent one-by-one as turns finish.
export function QueuePanel({ t, queue }: Props) {
  if (!queue.length) return null;
  return (
    <box backgroundColor={t.bg} paddingLeft={3} flexDirection="column" flexShrink={0}>
      <text content={`⋮ queued (${queue.length}) — sent in order as each turn finishes`} fg={t.accentDim} />
      {queue.map((q, i) => {
        const row = formatQueueLine(q.display, i, queue.length);
        return (
          <text
            key={i}
            content={styled`${fgChunk(row.head ? t.accent : t.accentDim)(row.prefix)}${fgChunk(row.head ? t.ink : t.muted)(row.text)}`}
          />
        );
      })}
    </box>
  );
}
