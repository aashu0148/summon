import { test, expect } from "bun:test";
import { fmtTok, oneLine, totalTok } from "../../src/lib/format.ts";

test("fmtTok: below 1000 is verbatim", () => {
  expect(fmtTok(0)).toBe("0");
  expect(fmtTok(950)).toBe("950");
  expect(fmtTok(999)).toBe("999");
});

test("fmtTok: thousands get one decimal + k", () => {
  expect(fmtTok(1000)).toBe("1.0k");
  expect(fmtTok(12300)).toBe("12.3k");
  expect(fmtTok(99_999)).toBe("100.0k"); // rounds up but still <100k branch
});

test("fmtTok: 100k+ drops the decimal", () => {
  expect(fmtTok(100_000)).toBe("100k");
  expect(fmtTok(123_400)).toBe("123k");
});

test("fmtTok: millions get one decimal + M", () => {
  expect(fmtTok(1_000_000)).toBe("1.0M");
  expect(fmtTok(2_000_000)).toBe("2.0M");
});

test("totalTok adds the in-flight turn onto the completed-session total", () => {
  // footer reflects streaming in real time: prior turns + current live turn
  expect(totalTok({ input: 3800, output: 14400 }, { input: 997, output: 42900 }))
    .toEqual({ input: 4797, output: 57300 });
});

test("totalTok with a zeroed live turn is just the session total", () => {
  // after a `result` event live resets to zero, so the footer holds steady
  expect(totalTok({ input: 4797, output: 57300 }, { input: 0, output: 0 }))
    .toEqual({ input: 4797, output: 57300 });
});

test("oneLine collapses whitespace and trims", () => {
  expect(oneLine("  a   b\n\tc  ")).toBe("a b c");
  expect(oneLine("")).toBe("");
  expect(oneLine("\n\n")).toBe("");
});
