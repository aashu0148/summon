import { test, expect, describe } from "bun:test";
import { buildAskPrompt, ASK_CONTEXT_TURNS, type AskTurn } from "../../src/domain/quick-ask.ts";

describe("buildAskPrompt", () => {
  test("includes the question verbatim", () => {
    const p = buildAskPrompt([], "how do I debounce?");
    expect(p).toContain("Question: how do I debounce?");
  });

  test("with no content turns, omits the context block entirely", () => {
    const p = buildAskPrompt([], "hi");
    expect(p).not.toContain("RECENT CONTEXT");
  });

  test("keeps only you/claude turns, dropping tool/file/sys/err/usage noise", () => {
    const turns: AskTurn[] = [
      { role: "you", text: "add a queue" },
      { role: "tool", text: "Read queue.ts" },
      { role: "file", text: "edited queue.ts" },
      { role: "sys", text: "theme → dark" },
      { role: "claude", text: "done, added enqueue()" },
    ];
    const p = buildAskPrompt(turns, "why?");
    expect(p).toContain("User: add a queue");
    expect(p).toContain("Assistant: done, added enqueue()");
    expect(p).not.toContain("Read queue.ts");
    expect(p).not.toContain("theme → dark");
  });

  test("takes only the last n content turns", () => {
    const turns: AskTurn[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "you" : "claude",
      text: `msg${i}`,
    }));
    const p = buildAskPrompt(turns, "q", 4);
    expect(p).toContain("msg16");
    expect(p).toContain("msg19");
    expect(p).not.toContain("msg15");
  });

  test("labels 'you' as User and 'claude' as Assistant", () => {
    const p = buildAskPrompt([{ role: "you", text: "hello" }, { role: "claude", text: "hi" }], "q");
    expect(p).toContain("User: hello");
    expect(p).toContain("Assistant: hi");
  });

  test("collapses multi-line turn text to a single line", () => {
    const p = buildAskPrompt([{ role: "you", text: "line one\n\nline  two" }], "q");
    expect(p).toContain("User: line one line two");
  });

  test("default context window is 7 turns", () => {
    expect(ASK_CONTEXT_TURNS).toBe(7);
  });
});
