import { test, expect } from "bun:test";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { rmSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { listSessions, sessionLabel } from "./sessions.ts";

test("sessionLabel prefers the model title over the raw first message", () => {
  expect(sessionLabel({ id: "a", summary: "help me fix the parser thing", mtimeMs: 0 })).toBe(
    "help me fix the parser thing",
  );
  expect(
    sessionLabel({ id: "a", summary: "help me fix the parser thing", title: "Fix parser", mtimeMs: 0 }),
  ).toBe("Fix parser");
  expect(sessionLabel({ id: "a", summary: "", mtimeMs: 0 })).toBe("");
});

test("listSessions attaches the stored title and keeps summary as fallback", () => {
  // listSessions derives the project dir from cwd under ~/.claude/projects, so we
  // build a throwaway session file there and clean it up afterwards.
  const cwd = mkdtempSync(join(tmpdir(), "summon-cwd-"));
  const projDir = join(homedir(), ".claude", "projects", cwd.replace(/\//g, "-"));
  const id = "test-session-1234";
  mkdirSync(projDir, { recursive: true });
  const file = join(projDir, `${id}.jsonl`);
  writeFileSync(
    file,
    JSON.stringify({ type: "user", message: { role: "user", content: "add resume titles please" } }) + "\n",
  );
  try {
    const titled = listSessions(cwd, 20, { [id]: "Add resume titles" });
    expect(titled).toHaveLength(1);
    expect(titled[0]!.summary).toBe("add resume titles please");
    expect(sessionLabel(titled[0]!)).toBe("Add resume titles");

    const untitled = listSessions(cwd, 20, {});
    expect(sessionLabel(untitled[0]!)).toBe("add resume titles please");
  } finally {
    rmSync(file, { force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});
