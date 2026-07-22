import { test, expect } from "bun:test";
import { parseUsage, limitLabel, usageBar, formatReset, sessionUsageWarning, type RawUsage } from "../../src/domain/usage.ts";

const SAMPLE: RawUsage = {
  limits: [
    { kind: "session", group: "session", percent: 61, severity: "normal", resets_at: "2026-07-07T11:49:59.897314+00:00", scope: null, is_active: true },
    { kind: "weekly_all", group: "weekly", percent: 55, severity: "normal", resets_at: "2026-07-10T15:59:59.897336+00:00", scope: null, is_active: false },
    { kind: "weekly_scoped", group: "weekly", percent: 12, severity: "normal", resets_at: "2026-07-10T15:59:59.897651+00:00", scope: { model: { display_name: "Fable" } }, is_active: false },
  ],
};

test("parseUsage maps every bucket with a percent to a labelled row", () => {
  const rows = parseUsage(SAMPLE);
  expect(rows).toEqual([
    { kind: "session", label: "Current session", percent: 61, severity: "normal", resetsAt: "2026-07-07T11:49:59.897314+00:00" },
    { kind: "weekly_all", label: "Weekly (all models)", percent: 55, severity: "normal", resetsAt: "2026-07-10T15:59:59.897336+00:00" },
    { kind: "weekly_scoped", label: "Weekly · Fable", percent: 12, severity: "normal", resetsAt: "2026-07-10T15:59:59.897651+00:00" },
  ]);
});

test("parseUsage drops buckets with a null percent and tolerates missing limits", () => {
  expect(parseUsage({ limits: [{ kind: "seven_day_opus", percent: null }] })).toEqual([]);
  expect(parseUsage({})).toEqual([]);
  expect(parseUsage({ limits: undefined } as RawUsage)).toEqual([]);
});

test("parseUsage clamps and rounds the percent into 0..100", () => {
  const rows = parseUsage({ limits: [
    { kind: "session", percent: 60.7 },
    { kind: "weekly_all", percent: 140 },
    { kind: "weekly_scoped", percent: -5, scope: null },
  ] });
  expect(rows.map((r) => r.percent)).toEqual([61, 100, 0]);
});

test("limitLabel falls back to the raw kind and to a generic scoped label", () => {
  expect(limitLabel({ kind: "overage", percent: 1 })).toBe("overage");
  expect(limitLabel({ kind: "weekly_scoped", percent: 1, scope: null })).toBe("Weekly (scoped)");
});

test("usageBar renders a fixed-width filled/empty meter", () => {
  expect(usageBar(50, 8)).toBe("████░░░░");
  expect(usageBar(0, 4)).toBe("░░░░");
  expect(usageBar(100, 4)).toBe("████");
  expect(usageBar(150, 4)).toBe("████");
  expect(usageBar(-10, 4)).toBe("░░░░");
});

test("sessionUsageWarning fires past the threshold with both reset times", () => {
  const now = Date.parse("2026-07-07T10:00:00Z");
  const limits = parseUsage(SAMPLE); // session at 61%
  const msg = sessionUsageWarning(limits, now);
  expect(msg).toBe(
    "Use carefully — you're at 61% of your session's usage (resets in 1h 49m). Weekly limit at 55% used (resets in 3d 5h).",
  );
});

test("sessionUsageWarning stays silent at or under the threshold", () => {
  const now = Date.parse("2026-07-07T10:00:00Z");
  expect(sessionUsageWarning(parseUsage(SAMPLE), now, 70)).toBeNull(); // 61% < 70%
  const half = parseUsage({ limits: [{ kind: "session", percent: 50 }] });
  expect(sessionUsageWarning(half, now)).toBeNull(); // exactly 50 is not "past" 50
});

test("sessionUsageWarning returns null when there is no session bucket", () => {
  const now = Date.parse("2026-07-07T10:00:00Z");
  const weeklyOnly = parseUsage({ limits: [{ kind: "weekly_all", percent: 99 }] });
  expect(sessionUsageWarning(weeklyOnly, now)).toBeNull();
});

test("sessionUsageWarning omits reset clauses when timestamps are missing", () => {
  const now = Date.parse("2026-07-07T10:00:00Z");
  const noResets = parseUsage({ limits: [{ kind: "session", percent: 80 }] });
  expect(sessionUsageWarning(noResets, now)).toBe(
    "Use carefully — you're at 80% of your session's usage.",
  );
});

test("formatReset produces a human relative string", () => {
  const now = Date.parse("2026-07-07T10:00:00Z");
  expect(formatReset("2026-07-07T10:30:00Z", now)).toBe("resets in 30m");
  expect(formatReset("2026-07-07T13:20:00Z", now)).toBe("resets in 3h 20m");
  expect(formatReset("2026-07-10T13:00:00Z", now)).toBe("resets in 3d 3h");
  expect(formatReset("2026-07-07T09:00:00Z", now)).toBe("resets now");
  expect(formatReset(null, now)).toBe("");
  expect(formatReset("not-a-date", now)).toBe("");
});
