import { test, expect, describe } from "bun:test";
import { routeMessage, enqueue, drain, previewLine, formatQueueLine, type QueueItem } from "../../src/domain/queue.ts";

const item = (s: string): QueueItem => ({ wire: s, display: s });

describe("routeMessage", () => {
  test("sends immediately when not busy", () => {
    expect(routeMessage(false, item("hi"))).toEqual({ action: "send", item: item("hi") });
  });
  test("queues when busy", () => {
    expect(routeMessage(true, item("hi"))).toEqual({ action: "queue", item: item("hi") });
  });
  test("passes the item through unchanged (preserves wire/display split)", () => {
    const it = { wire: "/skill big prompt", display: "/skill" };
    expect(routeMessage(true, it).item).toBe(it);
  });
});

describe("enqueue", () => {
  test("appends to the tail (FIFO order)", () => {
    const q = enqueue(enqueue([], item("a")), item("b"));
    expect(q.map((i) => i.wire)).toEqual(["a", "b"]);
  });
  test("does not mutate the input array", () => {
    const q0: QueueItem[] = [];
    enqueue(q0, item("a"));
    expect(q0).toEqual([]);
  });
});

describe("drain", () => {
  test("returns null while busy", () => {
    expect(drain(true, [item("a")])).toBeNull();
  });
  test("returns null when the queue is empty", () => {
    expect(drain(false, [])).toBeNull();
  });
  test("pulls the head and returns the rest", () => {
    const d = drain(false, [item("a"), item("b"), item("c")]);
    expect(d?.next.wire).toBe("a");
    expect(d?.rest.map((i) => i.wire)).toEqual(["b", "c"]);
  });
  test("does not mutate the input queue", () => {
    const q = [item("a"), item("b")];
    drain(false, q);
    expect(q.map((i) => i.wire)).toEqual(["a", "b"]);
  });
  test("carries image blocks through enqueue → drain untouched", () => {
    const images = [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] as const;
    const q = enqueue([], { wire: "look", display: "look [Image #1]", images: [...images] });
    const d = drain(false, q);
    expect(d?.next.images).toEqual([...images]);
  });
  test("draining repeatedly preserves FIFO", () => {
    let q = [item("a"), item("b"), item("c")];
    const sent: string[] = [];
    let d = drain(false, q);
    while (d) {
      sent.push(d.next.wire);
      q = d.rest;
      d = drain(false, q); // simulates a turn finishing each time (busy=false)
    }
    expect(sent).toEqual(["a", "b", "c"]);
  });
});

describe("previewLine", () => {
  test("collapses internal whitespace and trims", () => {
    expect(previewLine("  hello   there\nworld ")).toBe("hello there world");
  });
  test("truncates with an ellipsis past the cap", () => {
    expect(previewLine("x".repeat(80), 10)).toBe("xxxxxxxxxx…");
  });
  test("leaves short strings intact", () => {
    expect(previewLine("short")).toBe("short");
  });
});

describe("formatQueueLine", () => {
  test("head (index 0) gets the ▸ marker and a (next) tag", () => {
    const row = formatQueueLine("first", 0, 3);
    expect(row.head).toBe(true);
    expect(row.prefix).toBe("1 ▸ ");
    expect(row.text).toBe("first   (next)");
  });
  test("non-head rows are numbered and plain", () => {
    const row = formatQueueLine("second", 1, 3);
    expect(row.head).toBe(false);
    expect(row.prefix).toBe("2   ");
    expect(row.text).toBe("second");
  });
  test("numbers are right-aligned to the total's width so previews line up", () => {
    expect(formatQueueLine("a", 0, 12).prefix).toBe(" 1 ▸ ");
    expect(formatQueueLine("j", 9, 12).prefix).toBe("10   ");
  });
  test("previews the display text (collapse + truncate)", () => {
    expect(formatQueueLine("x".repeat(80), 1, 2, 10).text).toBe("xxxxxxxxxx…");
  });
});
