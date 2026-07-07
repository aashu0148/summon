import { test, expect, describe } from "bun:test";
import { groupTurns, toolActivity, toolLine } from "../../src/ui/constants.ts";

describe("toolActivity", () => {
  test("falls back to the generic phrase with no target", () => {
    expect(toolActivity("Read")).toBe("reading a file");
    expect(toolActivity("Bash")).toBe("running a command");
  });
  test("swaps the noun for the concrete target", () => {
    expect(toolActivity("Read", "src/foo.ts")).toBe("reading src/foo.ts");
    expect(toolActivity("Bash", "npm test")).toBe("running npm test");
  });
  test("unknown tool uses 'running <name>'", () => {
    expect(toolActivity("Frobnicate")).toBe("running Frobnicate");
  });
});

describe("toolLine", () => {
  test("names the tool and its target", () => {
    expect(toolLine("Read", "src/foo.ts")).toBe("→ Read  src/foo.ts");
  });
  test("drops the target when empty", () => {
    expect(toolLine("TodoWrite", "")).toBe("→ TodoWrite");
  });
});

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
