import type { Opt } from "../ui/constants.ts";
import type { AskQuestion } from "../session/claude-session.ts";

// Sentinel value for the always-appended "Other…" answer in an AskUserQuestion prompt.
// Lives here (not in ui/constants) so the pure ask logic has no UI dependency; constants
// re-exports it for the UI layer.
export const OTHER = "__other__";

// One recorded answer: a question's header plus the label(s) the user chose. `labels`
// holds one entry for a single-select answer and several for a multi-select answer.
export type AskAnswer = { header: string; labels: string[] };

// Build the selectable option list for a question: the model's options plus the
// always-appended free-text "Other…" entry (AskUserQuestion guarantees the user can
// give a custom answer — Claude never lists it, the client must).
export function askOptions(q: AskQuestion): Opt[] {
  return [
    ...q.options.map((o) => ({ name: o.label, description: o.description ?? "", value: o.label })),
    { name: "Other…", description: "type your own answer", value: OTHER },
  ];
}

// Toggle an index within a multi-select set, preserving insertion order so the
// confirmed labels come out in the order the user checked them.
export function toggleIndex(set: number[], idx: number): number[] {
  return set.includes(idx) ? set.filter((i) => i !== idx) : [...set, idx];
}

// Split confirmed multi-select options into concrete labels and whether the free-text
// "Other…" entry was among them (which means we still need to collect its typed text).
export function splitOther(opts: Opt[]): { labels: string[]; other: boolean } {
  const other = opts.some((o) => o.value === OTHER);
  const labels = opts.filter((o) => o.value !== OTHER).map((o) => o.value);
  return { labels, other };
}

// Whether recording an answer at `idx` finishes the prompt (last question) or advances.
export function isLastQuestion(total: number, idx: number): boolean {
  return idx + 1 >= total;
}

// The final wire message Claude receives, summarizing every recorded answer.
export function formatAnswers(answers: AskAnswer[]): string {
  return "The user selected — " + answers.map((a) => `${a.header}: ${a.labels.join(", ")}`).join("; ");
}

// Short system-transcript echo of the recorded answers.
export function echoAnswers(answers: AskAnswer[]): string {
  return "answered: " + answers.map((a) => `${a.header}=${a.labels.join(", ")}`).join(", ");
}
