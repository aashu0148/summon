import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Command, CommandCtx } from "./commands.ts";

// Filesystem-discovered skills. We follow Claude Code's convention: a skill is a
// directory containing a SKILL.md whose YAML frontmatter carries `name` and
// `description`. We scan both the project (cwd) and the user's home, under both
// `.claude` and `.ai`, in a precedence order (project beats global, .claude beats
// .ai) so a name defined closer to the project wins on collision.

export type Skill = {
  name: string;
  description: string;
  body: string; // SKILL.md content below the frontmatter
  dir: string; // absolute directory holding SKILL.md (for resource references)
  source: string; // human-readable origin, e.g. "project .claude"
};

// The roots we sweep, nearest-wins first. `label` shows where a skill came from.
// `home` is injectable so tests can point the "global" roots at a temp dir.
function skillRoots(cwd: string, home: string): { base: string; label: string }[] {
  return [
    { base: join(cwd, ".claude", "skills"), label: "project .claude" },
    { base: join(cwd, ".ai", "skills"), label: "project .ai" },
    { base: join(home, ".claude", "skills"), label: "global .claude" },
    { base: join(home, ".ai", "skills"), label: "global .ai" },
  ];
}

// Parse a tiny subset of YAML frontmatter: leading `---` block of `key: value`
// lines. Enough for name/description; anything fancier is ignored. Returns the
// frontmatter map plus the remaining body. Exported for unit tests.
export function parseFrontmatter(text: string): { fm: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { fm: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { fm: {}, body: text };
  const header = text.slice(text.indexOf("\n") + 1, end);
  const body = text.slice(text.indexOf("\n", end + 1) + 1);
  const fm: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = (m[2] ?? "").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    fm[m[1]!.toLowerCase()] = v;
  }
  return { fm, body: body.trimStart() };
}

function readSkill(dir: string, fallbackName: string, source: string): Skill | null {
  let raw: string;
  try {
    raw = readFileSync(join(dir, "SKILL.md"), "utf8");
  } catch {
    return null; // no SKILL.md → not a skill dir
  }
  const { fm, body } = parseFrontmatter(raw);
  const name = (fm.name || fallbackName).toLowerCase().replace(/\s+/g, "-");
  if (!name) return null;
  return { name, description: fm.description || "", body, dir, source };
}

/**
 * Discover all available skills, nearest-scope-wins on name collision. Cheap and
 * synchronous — called once at startup and refreshable via /reload if wired.
 */
export function loadSkills(cwd = process.cwd(), home = homedir()): Skill[] {
  const byName = new Map<string, Skill>();
  for (const { base, label } of skillRoots(cwd, home)) {
    let entries;
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      continue; // root doesn't exist — normal
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const skill = readSkill(join(base, e.name), e.name, label);
      if (skill && !byName.has(skill.name)) byName.set(skill.name, skill); // first (nearest) wins
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Build the prompt we forward to claude when a skill is invoked. We inline the
// skill's own instructions so it works regardless of which root it came from
// (the spawned CLI only auto-loads project .claude skills; .ai and global ones
// it has never seen). User args ride along as the concrete request. Exported for tests.
export function expandSkill(skill: Skill, args: string): string {
  const req = args.trim() ? `\n\n---\nRequest: ${args.trim()}` : "";
  return (
    `Use the "${skill.name}" skill (from ${skill.dir}). Follow its instructions:\n\n` +
    `${skill.body}${req}`
  );
}

// Position-preserving variant: the skill instructions are spliced in where the
// `/name` token actually sat, so text before the token leads and text after it
// trails — a mid-message "make X /design" reads as "make X" → skill → (nothing),
// instead of hoisting the request behind the whole skill body. With no
// surrounding text this collapses to the bare instruction block. Exported for tests.
export function expandSkillInline(skill: Skill, before: string, after: string): string {
  const invocation =
    `Use the "${skill.name}" skill (from ${skill.dir}). Follow its instructions:\n\n${skill.body}`;
  return [before.trim(), invocation, after.trim()].filter(Boolean).join("\n\n");
}

/** Adapt discovered skills to the Command shape so hints + dispatch treat them uniformly. */
export function skillsAsCommands(skills: Skill[]): Command[] {
  return skills.map((s) => ({
    name: s.name,
    description: s.description || `skill · ${s.source}`,
    run: (args: string, ctx: CommandCtx, pos?: { before: string; after: string }) => {
      const before = pos?.before ?? "";
      const after = pos?.after ?? args;
      const shown = [before, `/${s.name}`, after].map((p) => p.trim()).filter(Boolean).join(" ");
      ctx.sendPrompt(expandSkillInline(s, before, after), shown);
    },
  }));
}
