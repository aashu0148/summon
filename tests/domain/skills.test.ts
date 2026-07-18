import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSkills, parseFrontmatter, expandSkill, expandSkillInline, skillsAsCommands, type Skill } from "../../src/domain/skills.ts";
import type { CommandCtx } from "../../src/domain/commands.ts";

// Write a SKILL.md at <root>/skills/<slug>/SKILL.md.
function writeSkill(root: string, slug: string, frontmatter: string, body: string) {
  const dir = join(root, "skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
}

describe("parseFrontmatter", () => {
  test("extracts key/value pairs and strips quotes; returns the body", () => {
    const { fm, body } = parseFrontmatter(`---\nname: foo\ndescription: "does foo"\n---\nhello body`);
    expect(fm.name).toBe("foo");
    expect(fm.description).toBe("does foo");
    expect(body).toBe("hello body");
  });

  test("no frontmatter → empty map, whole text as body", () => {
    const { fm, body } = parseFrontmatter("just text");
    expect(fm).toEqual({});
    expect(body).toBe("just text");
  });
});

describe("loadSkills", () => {
  let cwd: string;
  let home: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "summon-cwd-"));
    home = mkdtempSync(join(tmpdir(), "summon-home-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test("discovers skills from project .claude and .ai plus global", () => {
    writeSkill(join(cwd, ".claude"), "alpha", "name: alpha\ndescription: A", "body A");
    writeSkill(join(cwd, ".ai"), "beta", "name: beta\ndescription: B", "body B");
    writeSkill(join(home, ".claude"), "gamma", "name: gamma\ndescription: G", "body G");
    const names = loadSkills(cwd, home).map((s) => s.name);
    expect(names).toEqual(["alpha", "beta", "gamma"]); // sorted
  });

  test("nearest scope wins on name collision (project .claude over global)", () => {
    writeSkill(join(cwd, ".claude"), "dup", "name: dup\ndescription: project", "P");
    writeSkill(join(home, ".claude"), "dup", "name: dup\ndescription: global", "G");
    const skills = loadSkills(cwd, home);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.description).toBe("project");
    expect(skills[0]!.source).toBe("project .claude");
  });

  test("falls back to the directory name when frontmatter omits name", () => {
    writeSkill(join(cwd, ".claude"), "no-name", "description: just a desc", "B");
    const skills = loadSkills(cwd, home);
    expect(skills[0]!.name).toBe("no-name");
  });

  test("missing roots are ignored (no throw, empty result)", () => {
    expect(loadSkills(cwd, home)).toEqual([]);
  });
});

describe("expandSkill / skillsAsCommands", () => {
  const skill: Skill = {
    name: "greet",
    description: "greet the user",
    body: "Say hello warmly.",
    dir: "/tmp/greet",
    source: "project .claude",
  };

  test("expandSkill inlines the body and appends the request when args are given", () => {
    const out = expandSkill(skill, "in French");
    expect(out).toContain("Say hello warmly.");
    expect(out).toContain("greet");
    expect(out).toContain("in French");
  });

  test("expandSkillInline splices instructions where the token sat (before leads, after trails)", () => {
    const out = expandSkillInline(skill, "make me a landing page", "");
    // request text comes first, then the skill body — not hoisted behind it
    expect(out.indexOf("make me a landing page")).toBeLessThan(out.indexOf("Say hello warmly."));
  });

  test("expandSkillInline collapses to the bare instructions with no surrounding text", () => {
    const out = expandSkillInline(skill, "", "");
    expect(out.startsWith('Use the "greet" skill')).toBe(true);
    expect(out).toContain("Say hello warmly.");
  });

  test("skillsAsCommands.run forwards expanded prompt with a short display label", () => {
    const calls: { wire: string; display?: string }[] = [];
    const ctx = { sendPrompt: (wire: string, display?: string) => calls.push({ wire, display }) } as unknown as CommandCtx;
    const cmd = skillsAsCommands([skill])[0]!;
    expect(cmd.name).toBe("greet");
    cmd.run("loudly", ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.display).toBe("/greet loudly"); // short label, not the full body
    expect(calls[0]!.wire).toContain("Say hello warmly."); // full instructions on the wire
  });

  test("skillsAsCommands.run preserves mid-message position from pos", () => {
    const calls: { wire: string; display?: string }[] = [];
    const ctx = { sendPrompt: (wire: string, display?: string) => calls.push({ wire, display }) } as unknown as CommandCtx;
    const cmd = skillsAsCommands([skill])[0]!;
    cmd.run("make me a landing page", ctx, { before: "make me a landing page", after: "" });
    expect(calls[0]!.display).toBe("make me a landing page /greet"); // label mirrors what was typed
    const wire = calls[0]!.wire;
    expect(wire.indexOf("make me a landing page")).toBeLessThan(wire.indexOf("Say hello warmly."));
  });

  test("empty description falls back to the source origin", () => {
    const cmd = skillsAsCommands([{ ...skill, description: "" }])[0]!;
    expect(cmd.description).toContain("project .claude");
  });
});
