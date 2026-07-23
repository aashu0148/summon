// Reply styles — session-wide toggles that shape how Claude answers. While one is
// active, every outgoing user message gets its instruction appended to the WIRE
// text only; the transcript shows what the user typed (sendPrompt display ≠ wire).
// One style at a time — stacked instructions would conflict, so activating one
// replaces the other. Pure so the wrap/toggle logic is unit-tested; the active
// style itself lives in app state (see app.tsx).

export type ReplyStyle = "caveman" | "crossquestion";

export const INSTRUCTIONS: Record<ReplyStyle, string> = {
  // Compress the GRAMMAR: shortest possible phrasing, fragments allowed.
  caveman: [
    "STYLE (persistent, apply to this reply): answer caveman-terse.",
    "Drop articles, filler words, pleasantries, hedging. Fragments OK. Short synonyms",
    "(big not extensive, fix not implement-a-solution). No decorative tables or emoji.",
    "Keep code blocks, commands, technical terms, API names, and error strings exact.",
    "Pattern: [thing] [action] [reason]. [next step].",
    "Exception — use normal clear prose for security warnings, irreversible-action",
    "confirmations, or multi-step sequences where terseness risks misreading.",
  ].join("\n"),
  // Compress the SCOPE: answer only what was asked, in plain teaching language.
  crossquestion: [
    "ANSWER MODE (persistent, apply to this reply): the user is cross-questioning you.",
    "Answer ONLY the question asked, in the shortest form that fully answers it —",
    "one word, one line, or one short paragraph.",
    "Speak like a senior engineer explaining to a teammate: high-level, simple plain",
    "language anyone can follow, teaching the idea rather than dumping jargon or",
    "low-level detail. If a technical term is unavoidable, define it in a few words.",
    "No suggestions, no next steps, no offers, no restating the question, no extra",
    "context beyond the answer. Cite file:line when referencing code.",
    "Exception — use normal full prose for security warnings or irreversible-action",
    "confirmations.",
  ].join("\n"),
};

/** Wire text for an outgoing message: unchanged when no style, instruction appended when active. */
export function wrapPrompt(text: string, style: ReplyStyle | null): string {
  return style ? `${text}\n\n${INSTRUCTIONS[style]}` : text;
}

/** Next active style after requesting one: same again turns it off, different switches. */
export function toggleStyle(current: ReplyStyle | null, requested: ReplyStyle): ReplyStyle | null {
  return current === requested ? null : requested;
}
