import { test, expect, describe } from "bun:test";
import { groupTurns } from "../../src/ui/constants.ts";

describe("groupTurns", () => {
  test("empty in, empty out", () => {
    expect(groupTurns([])).toEqual([]);
  });

  test("collapses consecutive same-role turns into one group", () => {
    const groups = groupTurns([
      { role: "claude", text: "a" },
      { role: "claude", text: "b" },
      { role: "claude", text: "c" },
    ]);
    expect(groups).toEqual([{ role: "claude", texts: ["a", "b", "c"] }]);
  });

  test("starts a new group when the role changes", () => {
    const groups = groupTurns([
      { role: "you", text: "hi" },
      { role: "claude", text: "1" },
      { role: "claude", text: "2" },
      { role: "you", text: "more" },
      { role: "claude", text: "3" },
    ]);
    expect(groups).toEqual([
      { role: "you", texts: ["hi"] },
      { role: "claude", texts: ["1", "2"] },
      { role: "you", texts: ["more"] },
      { role: "claude", texts: ["3"] },
    ]);
  });

  test("keeps distinct adjacent roles separate", () => {
    const groups = groupTurns([
      { role: "sys", text: "s" },
      { role: "err", text: "e" },
      { role: "file", text: "f" },
    ]);
    expect(groups.map((g) => g.role)).toEqual(["sys", "err", "file"]);
  });
});
