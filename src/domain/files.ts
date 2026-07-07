import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Directories we never want to surface in @-mention autocomplete.
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "out", "build", "coverage", ".next", ".cache", ".turbo",
]);

/**
 * Split a query into its directory prefix (up to and including the last "/") and the
 * trailing fragment: "../../src/ap" → { dir: "../../src/", frag: "ap" }, "app" →
 * { dir: "", frag: "app" }. The dir is what decides where autocomplete looks.
 */
export function splitQueryDir(query: string): { dir: string; frag: string } {
  const i = query.lastIndexOf("/");
  return i < 0 ? { dir: "", frag: query } : { dir: query.slice(0, i + 1), frag: query.slice(i + 1) };
}

/**
 * Recursively list files under `root` (cheap, capped, hidden + heavy dirs skipped). Each
 * emitted path is `prefix` + its path relative to `root`, so completions keep the exact
 * text the user typed (e.g. a leading "../").
 */
function walkFiles(root: string, prefix: string, cap: number): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= cap) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= cap) return;
      if (e.name.startsWith(".")) continue; // skip dotfiles/dirs
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
      } else {
        out.push(prefix + relative(root, join(dir, e.name)));
      }
    }
  };
  walk(root);
  return out;
}

/** Recursively list project files relative to `root` (cheap, capped, hidden entries skipped). */
export function listProjectFiles(root: string, cap = 4000): string[] {
  return walkFiles(root, "", cap);
}

/**
 * List files for a query's directory prefix. Normal queries stay rooted at `cwd`; when the
 * query climbs out of the project ("../", "../../src/") the walk is rooted at that resolved
 * ancestor and every result keeps the "../" prefix so completing it stays a valid path.
 */
export function listFilesForQuery(cwd: string, query: string, cap = 4000): string[] {
  const { dir } = splitQueryDir(query);
  if (!dir) return listProjectFiles(cwd, cap);
  return walkFiles(resolve(cwd, dir), dir, cap);
}

/**
 * Rank files against a query for @-mention autocomplete. Basename-prefix beats
 * path-prefix beats basename-substring beats path-substring; shorter paths win ties.
 * Empty query → the shortest (usually top-level) paths.
 */
export function matchFiles(files: string[], query: string, limit = 6): string[] {
  const q = query.toLowerCase();
  if (!q) return [...files].sort((a, b) => a.length - b.length).slice(0, limit);
  const scored: [number, number, string][] = [];
  for (const f of files) {
    const lf = f.toLowerCase();
    const base = lf.slice(lf.lastIndexOf("/") + 1);
    let score = -1;
    if (base.startsWith(q)) score = 0;
    else if (lf.startsWith(q)) score = 1;
    else if (base.includes(q)) score = 2;
    else if (lf.includes(q)) score = 3;
    if (score >= 0) scored.push([score, f.length, f]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, limit).map((x) => x[2]);
}
