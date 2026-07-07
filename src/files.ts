import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

// Directories we never want to surface in @-mention autocomplete.
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "out", "build", "coverage", ".next", ".cache", ".turbo",
]);

/** Recursively list project files relative to `root` (cheap, capped, hidden entries skipped). */
export function listProjectFiles(root: string, cap = 4000): string[] {
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
        out.push(relative(root, join(dir, e.name)));
      }
    }
  };
  walk(root);
  return out;
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
