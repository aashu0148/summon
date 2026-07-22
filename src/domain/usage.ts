// Pure parsing + formatting for the `/usage` plan view. The raw shape comes from
// Anthropic's OAuth usage endpoint (see session/usage-client.ts); everything here is
// I/O-free so it can be unit-tested against recorded responses.

export type RawLimit = {
  kind: string;
  group?: string;
  percent: number | null;
  severity?: string;
  resets_at?: string | null;
  scope?: { model?: { display_name?: string | null } | null } | null;
  is_active?: boolean;
};

export type RawUsage = { limits?: RawLimit[] };

export type UsageLimit = {
  kind: string;
  label: string;
  percent: number;
  severity: string;
  resetsAt: string | null;
};

const KIND_LABELS: Record<string, string> = {
  session: "Current session",
  weekly_all: "Weekly (all models)",
  weekly_scoped: "Weekly (scoped)",
};

export function limitLabel(l: RawLimit): string {
  if (l.kind === "weekly_scoped") {
    const model = l.scope?.model?.display_name;
    return model ? `Weekly · ${model}` : KIND_LABELS.weekly_scoped!;
  }
  return KIND_LABELS[l.kind] ?? l.kind;
}

/** Turn the endpoint payload into the rows the panel renders. Drops buckets with no percent. */
export function parseUsage(raw: RawUsage): UsageLimit[] {
  const limits = Array.isArray(raw?.limits) ? raw.limits : [];
  return limits
    .filter((l) => typeof l.percent === "number")
    .map((l) => ({
      kind: l.kind,
      label: limitLabel(l),
      percent: Math.max(0, Math.min(100, Math.round(l.percent as number))),
      severity: l.severity ?? "normal",
      resetsAt: l.resets_at ?? null,
    }));
}

/**
 * A one-line "use carefully" nudge shown at session start when the current-session bucket
 * is past `threshold`% used. Returns null when under threshold or there's no session data,
 * so the caller can skip pushing anything. Also mentions when the session and the weekly
 * limit reset, so the user knows how long the pinch lasts.
 */
export function sessionUsageWarning(limits: UsageLimit[], nowMs: number, threshold = 50): string | null {
  const session = limits.find((l) => l.kind === "session");
  if (!session || session.percent <= threshold) return null;
  const sessReset = formatReset(session.resetsAt, nowMs);
  const weekly = limits.find((l) => l.kind === "weekly_all") ?? limits.find((l) => l.kind === "weekly_scoped");
  const weeklyReset = weekly ? formatReset(weekly.resetsAt, nowMs) : "";
  let msg = `Use carefully — you're at ${session.percent}% of your session's usage`;
  msg += sessReset ? ` (${sessReset}).` : ".";
  if (weekly) {
    msg += ` Weekly limit at ${weekly.percent}% used`;
    msg += weeklyReset ? ` (${weeklyReset}).` : ".";
  }
  return msg;
}

/** A fixed-width text meter, e.g. usageBar(50, 8) -> "████░░░░". */
export function usageBar(percent: number, width = 24): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Human "resets in …" from an ISO timestamp, relative to `nowMs`. Empty when unknown. */
export function formatReset(resetsAt: string | null, nowMs: number): string {
  if (!resetsAt) return "";
  const at = Date.parse(resetsAt);
  if (Number.isNaN(at)) return "";
  const diff = at - nowMs;
  if (diff <= 0) return "resets now";
  const mins = Math.floor(diff / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  if (days > 0) return `resets in ${days}d ${hours}h`;
  if (hours > 0) return `resets in ${hours}h ${rem}m`;
  return `resets in ${rem}m`;
}
