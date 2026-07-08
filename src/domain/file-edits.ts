// A run of consecutive edits to the SAME file collapses into a single transcript row
// whose +/− counts accumulate, instead of one row per edit. This mirrors how consecutive
// same-role messages are grouped — but at a finer grain: the file path is the key, so
// ten edits to one file become one updating row, while a different file (or an edit
// interrupted by another kind of turn) starts a fresh row.

// `kind` records whether the removed count is *known*. An Edit/MultiEdit carries both the
// old and new text, so we compute a real line diff (accurate +/−). A Write/NotebookEdit
// only carries the new content — the prior file contents aren't in the tool input — so we
// can count additions but genuinely cannot know removals. Those render as a "WRITE" row
// showing just "+N" instead of a misleading "−0" under an "EDIT" label.
export type FileEditKind = "write" | "edit";
export type FileEdit = { rel: string; added: number; removed: number; kind: FileEditKind };

/** cwd-relative path, matching how file rows are labelled elsewhere. */
export const relPath = (path: string, cwd: string): string =>
  path.startsWith(cwd + "/") ? path.slice(cwd.length + 1) : path;

/**
 * The transcript text for a file row. Edits show "✎ path  +N −M"; writes show "✎ path  +N"
 * (removals unknown — see FileEditKind), so a full-file overwrite no longer reads as an
 * in-place edit that deleted nothing.
 */
export const fileTurnText = (e: FileEdit): string =>
  e.kind === "write" ? `✎ ${e.rel}  +${e.added}` : `✎ ${e.rel}  +${e.added} −${e.removed}`;

/**
 * Count changed lines between two blocks of text via the classic LCS diff: lines present
 * in both (in order) are unchanged context, everything else is an add or a remove. This is
 * what makes a one-line tweak inside a ten-line Edit read as "+1 −1" instead of "+10 −10"
 * (the old code counted every line of new_string/old_string, context included).
 */
export function diffLineCounts(oldStr: string, newStr: string): { added: number; removed: number } {
  const a = oldStr.length ? oldStr.split("\n") : [];
  const b = newStr.length ? newStr.split("\n") : [];
  const m = a.length, n = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]. One extra row/col of zeros as the base case.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const lcs = dp[0]![0]!;
  return { added: n - lcs, removed: m - lcs };
}

/**
 * Fold a new edit into the previous file row when it targets the same file AND is the same
 * kind, returning the accumulated row. Returns null when there's no mergeable predecessor
 * (different file, different kind, or the previous turn wasn't a matching file row) — the
 * caller then starts a new row.
 */
export function foldFileEdit(prev: FileEdit | undefined, next: FileEdit): FileEdit | null {
  if (!prev || prev.rel !== next.rel || prev.kind !== next.kind) return null;
  return { rel: next.rel, added: prev.added + next.added, removed: prev.removed + next.removed, kind: next.kind };
}
