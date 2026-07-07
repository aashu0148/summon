import { test, expect, describe } from "bun:test";
import { ClaudeSession, fileChangeFromToolUse, toolTarget, type SessionEvent } from "../../src/session/claude-session.ts";

// These tests exercise the stream-json → SessionEvent parsing OFFLINE — no `claude`
// binary is spawned and no billed calls are made (that's what scripts/smoke.ts and
// scripts/probe.ts are for). We drive the private line handler directly: parsing does
// not need the child process (control responses write to a null stdin and no-op).
function harness() {
  const s = new ClaudeSession();
  const events: SessionEvent[] = [];
  s.on("event", (e) => events.push(e));
  const feed = (obj: unknown) => (s as any).handleLine(JSON.stringify(obj));
  return { s, events, feed };
}
const only = (events: SessionEvent[], type: string) => events.filter((e) => e.type === type);

describe("fileChangeFromToolUse", () => {
  test("Write counts content lines as added, 0 removed", () => {
    expect(fileChangeFromToolUse("Write", { file_path: "a.ts", content: "x\ny\nz" }))
      .toEqual({ path: "a.ts", added: 3, removed: 0 });
  });
  test("Edit counts new vs old lines", () => {
    expect(fileChangeFromToolUse("Edit", { file_path: "a.ts", new_string: "1\n2", old_string: "1" }))
      .toEqual({ path: "a.ts", added: 2, removed: 1 });
  });
  test("MultiEdit sums across edits", () => {
    const fc = fileChangeFromToolUse("MultiEdit", {
      file_path: "a.ts",
      edits: [{ new_string: "a\nb", old_string: "a" }, { new_string: "c", old_string: "c\nd\ne" }],
    });
    expect(fc).toEqual({ path: "a.ts", added: 3, removed: 4 });
  });
  test("NotebookEdit falls back through path fields", () => {
    expect(fileChangeFromToolUse("NotebookEdit", { notebook_path: "n.ipynb", new_source: "x" }))
      .toEqual({ path: "n.ipynb", added: 1, removed: 0 });
  });
  test("non-mutating tool returns null", () => {
    expect(fileChangeFromToolUse("Read", { file_path: "a.ts" })).toBeNull();
    expect(fileChangeFromToolUse("Bash", { command: "ls" })).toBeNull();
  });
  test("empty string content counts as 0 lines", () => {
    expect(fileChangeFromToolUse("Write", { file_path: "a.ts", content: "" }))
      .toEqual({ path: "a.ts", added: 0, removed: 0 });
  });
});

describe("toolTarget", () => {
  test("pulls the file path for read/write tools", () => {
    expect(toolTarget("Read", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(toolTarget("Write", { file_path: "x.ts", content: "…" })).toBe("x.ts");
  });
  test("pulls the command / pattern / url / query", () => {
    expect(toolTarget("Bash", { command: "npm test" })).toBe("npm test");
    expect(toolTarget("Grep", { pattern: "TODO" })).toBe("TODO");
    expect(toolTarget("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
    expect(toolTarget("WebFetch", { url: "https://x.dev" })).toBe("https://x.dev");
    expect(toolTarget("WebSearch", { query: "bun test" })).toBe("bun test");
  });
  test("NotebookEdit and Task fall back through fields", () => {
    expect(toolTarget("NotebookEdit", { file_path: "n.ipynb" })).toBe("n.ipynb");
    expect(toolTarget("Task", { subagent_type: "Explore" })).toBe("Explore");
  });
  test("unknown tool or missing input yields empty string", () => {
    expect(toolTarget("TodoWrite", { todos: [] })).toBe("");
    expect(toolTarget("Read", {})).toBe("");
    expect(toolTarget("Read", undefined)).toBe("");
  });
});

describe("line parsing", () => {
  test("ignores blank and non-JSON lines", () => {
    const { events, feed } = harness();
    (feed as any)("");
    (feed as any)("   ");
    (feed as any)("not json {");
    expect(events).toEqual([]);
  });

  test("system:init → init event", () => {
    const { events, feed } = harness();
    feed({ type: "system", subtype: "init", session_id: "sess-123", model: "claude-opus-4-8", apiKeySource: "none" });
    expect(events).toEqual([{ type: "init", sessionId: "sess-123", model: "claude-opus-4-8", apiKeySource: "none" }]);
  });

  test("text + thinking stream deltas", () => {
    const { events, feed } = harness();
    feed({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } } });
    feed({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } } });
    expect(only(events, "delta")).toEqual([{ type: "delta", text: "hi" }]);
    expect(only(events, "thinking")).toEqual([{ type: "thinking", text: "hmm" }]);
  });

  test("assistant frame emits assistant_done with joined text", () => {
    const { events, feed } = harness();
    feed({ type: "assistant", message: { content: [{ type: "text", text: "one " }, { type: "text", text: "two" }] } });
    expect(only(events, "assistant_done")).toEqual([{ type: "assistant_done", text: "one two" }]);
  });

  test("assistant tool_use emits file_change and dedupes by id across frames", () => {
    const { events, feed } = harness();
    const frame = {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu_1", name: "Write", input: { file_path: "z.ts", content: "a\nb" } }] },
    };
    feed(frame);
    feed(frame); // repeated frame — must NOT emit a second file_change
    expect(only(events, "file_change")).toEqual([{ type: "file_change", path: "z.ts", added: 2, removed: 0 }]);
  });

  test("rate_limit_event → rate_limit", () => {
    const { events, feed } = harness();
    feed({ type: "rate_limit_event", rate_limit_info: { rateLimitType: "five_hour", status: "allowed" } });
    expect(only(events, "rate_limit")).toEqual([{ type: "rate_limit", kind: "five_hour", status: "allowed" }]);
  });

  test("result → result event with cost + usage", () => {
    const { events, feed } = harness();
    feed({ type: "result", total_cost_usd: 0.0123, duration_ms: 900, result: "done", usage: { input_tokens: 5, output_tokens: 7 } });
    expect(only(events, "result")).toEqual([
      { type: "result", costUsd: 0.0123, ms: 900, text: "done", usage: { input: 5, output: 7, cacheRead: 0, cacheCreate: 0 } },
    ]);
  });

  test("errored result also surfaces an error event", () => {
    const { events, feed } = harness();
    feed({ type: "result", subtype: "error_max_turns", total_cost_usd: 0, errors: ["hit the wall"] });
    expect(only(events, "error")).toEqual([{ type: "error", message: "hit the wall" }]);
  });

  test("available_models + error line", () => {
    const { events, feed } = harness();
    feed({ type: "available_models", models: ["claude-opus-4-8", "claude-sonnet-4-6"] });
    feed({ type: "error", error: { message: "boom" } });
    expect(only(events, "available_models")).toEqual([{ type: "available_models", models: ["claude-opus-4-8", "claude-sonnet-4-6"] }]);
    expect(only(events, "error")).toEqual([{ type: "error", message: "boom" }]);
  });
});

describe("control requests", () => {
  test("can_use_tool for a normal tool auto-approves → tool event", () => {
    const { events, feed } = harness();
    feed({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } });
    expect(only(events, "tool")).toEqual([{ type: "tool", name: "Bash", detail: "ls" }]);
    expect(only(events, "ask")).toEqual([]);
  });

  test("AskUserQuestion surfaces an ask event instead of auto-approving", () => {
    const { events, feed } = harness();
    const questions = [{ question: "Pick", header: "Choice", options: [{ label: "A" }, { label: "B" }] }];
    feed({ type: "control_request", request_id: "r2", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions } } });
    expect(only(events, "ask")).toEqual([{ type: "ask", requestId: "r2", questions }]);
    expect(only(events, "tool")).toEqual([]);
  });

  test("unknown control subtype is surfaced, not swallowed", () => {
    const { events, feed } = harness();
    feed({ type: "control_request", request_id: "r3", request: { subtype: "some_new_thing" } });
    const ctrl = only(events, "control");
    expect(ctrl).toHaveLength(1);
    expect((ctrl[0] as any).subtype).toBe("some_new_thing");
  });
});

describe("live usage accumulation", () => {
  test("running total only grows within a turn and never regresses on sparse deltas", () => {
    const { events, feed } = harness();
    const usages = () => only(events, "usage").map((e) => (e as any).usage);

    // message_start: first message begins with input=10, output=1
    feed({ type: "stream_event", event: { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } } });
    // message_delta: output climbs to 5 (input absent — must not regress to 0)
    feed({ type: "stream_event", event: { type: "message_delta", usage: { output_tokens: 5 } } });
    // sparse delta: output=3 < 5 — cumulative must hold at the max, not drop
    feed({ type: "stream_event", event: { type: "message_delta", usage: { output_tokens: 3 } } });
    // new message_start: banks the finished message, seeds a second one (input=20)
    feed({ type: "stream_event", event: { type: "message_start", message: { usage: { input_tokens: 20, output_tokens: 1 } } } });

    const seq = usages();
    expect(seq[0]).toEqual({ input: 10, output: 1, cacheRead: 0, cacheCreate: 0 });
    expect(seq[1]).toEqual({ input: 10, output: 5, cacheRead: 0, cacheCreate: 0 });
    expect(seq[2]).toEqual({ input: 10, output: 5, cacheRead: 0, cacheCreate: 0 }); // held, not regressed
    expect(seq[3]).toEqual({ input: 30, output: 6, cacheRead: 0, cacheCreate: 0 }); // 10+20 in, 5+1 out
  });

  test("result resets the turn so the next turn's counter starts clean", () => {
    const { events, feed } = harness();
    feed({ type: "stream_event", event: { type: "message_start", message: { usage: { input_tokens: 100, output_tokens: 50 } } } });
    feed({ type: "result", total_cost_usd: 0, usage: { input_tokens: 100, output_tokens: 50 } });
    feed({ type: "stream_event", event: { type: "message_start", message: { usage: { input_tokens: 7, output_tokens: 2 } } } });
    const last = only(events, "usage").at(-1) as any;
    expect(last.usage).toEqual({ input: 7, output: 2, cacheRead: 0, cacheCreate: 0 }); // not 107/52
  });
});
