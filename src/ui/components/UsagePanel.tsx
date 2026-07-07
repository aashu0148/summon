import { t as styled, fg as fgChunk } from "@opentui/core";
import type { Theme } from "../theme.ts";
import type { UsageView } from "../hooks/useUsage.ts";
import { usageBar, formatReset, type UsageLimit } from "../../domain/usage.ts";

type Props = { t: Theme; usage: UsageView; now: number };

const BAR_WIDTH = 24;

function LimitRow({ t, limit, now }: { t: Theme; limit: UsageLimit; now: number }) {
  const bar = usageBar(limit.percent, BAR_WIDTH);
  const filled = bar.replace(/░+$/, "");
  const empty = bar.slice(filled.length);
  const barColor = limit.percent >= 80 ? t.warn : t.accent;
  const reset = formatReset(limit.resetsAt, now);
  return (
    <box flexDirection="column" marginBottom={1}>
      <text content={`${limit.label.padEnd(22)} ${String(limit.percent).padStart(3)}% used`} fg={t.ink} />
      <text content={styled`${fgChunk(barColor)(filled)}${fgChunk(t.accentDim)(empty)}`} />
      {reset ? <text content={reset} fg={t.muted} /> : null}
    </box>
  );
}

// Read-only overlay for /usage — mirrors Claude Code's plan-usage screen. Esc closes it
// (handled by the app's keyboard router, since nothing here is focusable).
export function UsagePanel({ t, usage, now }: Props) {
  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingTop={1} backgroundColor={t.bg}>
      <text content="Plan usage" fg={t.accent} />
      <box marginTop={1} flexDirection="column">
        {usage.status === "loading" ? <text content="fetching your plan usage…" fg={t.muted} /> : null}
        {usage.status === "error" ? <text content={usage.message} fg={t.warn} /> : null}
        {usage.status === "ready" && usage.limits.length === 0 ? (
          <text content="no usage limits reported for this plan." fg={t.muted} />
        ) : null}
        {usage.status === "ready"
          ? usage.limits.map((l, i) => <LimitRow key={i} t={t} limit={l} now={now} />)
          : null}
      </box>
      <text content="Esc to close" fg={t.accentDim} marginTop={1} />
    </box>
  );
}
