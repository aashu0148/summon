import { test, expect } from "bun:test";
import {
  attentionMessage,
  attentionSequence,
  osc9,
  shouldNotify,
  FOCUS_REPORT_ON,
  FOCUS_REPORT_OFF,
} from "../../src/domain/attention.ts";

test("shouldNotify: when focus reporting is live, only nudge while unfocused", () => {
  expect(shouldNotify(false, true)).toBe(true); // away — nudge
  expect(shouldNotify(true, true)).toBe(false); // watching — stay quiet
});

test("shouldNotify: without live focus reporting, always nudge (terminal can't tell us)", () => {
  // e.g. macOS Terminal.app never sends focus events, so `focused` can't be trusted.
  expect(shouldNotify(true, false)).toBe(true);
  expect(shouldNotify(false, false)).toBe(true);
});

test("attentionMessage leads with the state: 'Action required' vs 'Done'", () => {
  expect(attentionMessage("blocked", "fix the parser")).toBe("Action required — fix the parser");
  expect(attentionMessage("done", "fix the parser")).toBe("Done — fix the parser");
});

test("attentionMessage falls back to 'summon' for an empty label", () => {
  expect(attentionMessage("done", "")).toBe("Done — summon");
});

test("osc9 wraps the message in an OSC 9 notification sequence", () => {
  expect(osc9("hi")).toBe("\x1b]9;hi\x07");
});

test("attentionSequence rings the bell then fires the OSC 9 toast", () => {
  expect(attentionSequence("done")).toBe("\x07\x1b]9;done\x07");
});

test("focus-reporting escapes are the DECSET 1004 on/off pair", () => {
  expect(FOCUS_REPORT_ON).toBe("\x1b[?1004h");
  expect(FOCUS_REPORT_OFF).toBe("\x1b[?1004l");
});
