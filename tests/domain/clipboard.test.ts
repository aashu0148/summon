import { test, expect } from "bun:test";
import { ctrlCAction, clipboardCommands } from "../../src/domain/clipboard.ts";

test("clipboardCommands picks the native tool per platform", () => {
  expect(clipboardCommands("darwin")).toEqual([["pbcopy"]]);
  expect(clipboardCommands("win32")).toEqual([["clip"]]);
  // Linux returns ordered candidates (Wayland, then X11) so the first installed one wins.
  const linux = clipboardCommands("linux");
  expect(linux[0]).toEqual(["wl-copy"]);
  expect(linux.map((c) => c[0])).toEqual(["wl-copy", "xclip", "xsel"]);
});

test("ctrlCAction quits when there is no selection", () => {
  expect(ctrlCAction(null)).toEqual({ action: "quit" });
  expect(ctrlCAction(undefined)).toEqual({ action: "quit" });
  expect(ctrlCAction("")).toEqual({ action: "quit" });
});

test("ctrlCAction quits when the selection is only whitespace", () => {
  expect(ctrlCAction("   \n\t ")).toEqual({ action: "quit" });
});

test("ctrlCAction copies real selected text verbatim (whitespace preserved)", () => {
  expect(ctrlCAction("hello world")).toEqual({ action: "copy", text: "hello world" });
  // Leading/trailing whitespace is kept in the copied text — only the emptiness check trims.
  expect(ctrlCAction("  foo\nbar  ")).toEqual({ action: "copy", text: "  foo\nbar  " });
});
