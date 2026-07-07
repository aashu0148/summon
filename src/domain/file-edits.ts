// A run of consecutive edits to the SAME file collapses into a single transcript row
// whose +/− counts accumulate, instead of one row per edit. This mirrors how consecutive
// same-role messages are grouped — but at a finer grain: the file path is the key, so
// ten edits to one file become one updating row, while a different file (or an edit
// interrupted by another kind of turn) starts a fresh row.

export type FileEdit = { rel: string; added: number; removed: number };

/** cwd-relative path, matching how file rows are labelled elsewhere. */
export const relPath = (path: string, cwd: string): string =>
  path.startsWith(cwd + "/") ? path.slice(cwd.length + 1) : path;

/** The transcript text for a file row, e.g. "✎ src/foo.ts  +12 −3". */
export const fileTurnText = (e: FileEdit): string => `✎ ${e.rel}  +${e.added} −${e.removed}`;

/**
 * Fold a new edit into the previous file row when it targets the same file, returning the
 * accumulated row. Returns null when there's no mergeable predecessor (different file, or
 * the previous turn wasn't a file row) — the caller then starts a new row.
 */
export function foldFileEdit(prev: FileEdit | undefined, next: FileEdit): FileEdit | null {
  if (!prev || prev.rel !== next.rel) return null;
  return { rel: next.rel, added: prev.added + next.added, removed: prev.removed + next.removed };
}
