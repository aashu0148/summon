// Shared formatting helpers. Previously duplicated across app.tsx / commands.ts
// (fmtTok) and title.ts / title-gen.ts (oneLine).

// compact token count: 950 -> "950", 12300 -> "12.3k", 2_000_000 -> "2.0M"
export function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(n >= 100_000 ? 0 : 1) + "k";
  return String(n);
}

// collapse all whitespace runs to single spaces and trim
export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

type Tok = { input: number; output: number; cacheRead: number; cacheCreate: number };

// True input volume sent to the API: the fresh (uncached) input plus everything
// replayed from / written to the prompt cache. During a tool-use turn nearly all of
// the growing conversation is a cache read, so `input` alone barely moves — this is
// the number that reflects what actually went over the wire.
export const inTok = (t: Tok): number => t.input + t.cacheRead + t.cacheCreate;

// Running session token total: completed turns (sessionTok) plus the in-flight turn
// (live). The footer uses this so its counts track streaming in real time instead of
// only jumping when a turn finishes. No double-count: on the `result` event `live`
// resets to zero in the same batch that folds the turn into sessionTok.
export const totalTok = (sessionTok: Tok, live: Tok): Tok => ({
  input: sessionTok.input + live.input,
  output: sessionTok.output + live.output,
  cacheRead: sessionTok.cacheRead + live.cacheRead,
  cacheCreate: sessionTok.cacheCreate + live.cacheCreate,
});
