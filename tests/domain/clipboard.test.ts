import { test, expect } from "bun:test";
import { clipboardCommands, shouldStartSelection } from "../../src/domain/clipboard.ts";

test("shouldStartSelection begins a selection only on a selectable target", () => {
  // The scrollbox content box is only selectable after we opt it in; when it is, a
  // mousedown there must kick off the selection by hand (OpenTUI won't auto-start on a box).
  expect(shouldStartSelection({ selectable: true })).toBe(true);
  expect(shouldStartSelection({ selectable: false })).toBe(false);
  // No target / missing flag → never start (e.g. press lands on a non-selectable region).
  expect(shouldStartSelection(null)).toBe(false);
  expect(shouldStartSelection(undefined)).toBe(false);
  expect(shouldStartSelection({})).toBe(false);
});

test("clipboardCommands picks the native tool per platform", () => {
  expect(clipboardCommands("darwin")).toEqual([["pbcopy"]]);
  expect(clipboardCommands("win32")).toEqual([["clip"]]);
  // Linux returns ordered candidates (Wayland, then X11) so the first installed one wins.
  const linux = clipboardCommands("linux");
  expect(linux[0]).toEqual(["wl-copy"]);
  expect(linux.map((c) => c[0])).toEqual(["wl-copy", "xclip", "xsel"]);
});
