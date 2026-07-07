import { ClaudeSession } from "../src/claude-session.ts";
const s = new ClaudeSession();
let deltas = 0, done = "";
s.on("event", (e) => {
  if (e.type === "init") console.log("INIT auth=%s model=%s", e.apiKeySource, e.model);
  else if (e.type === "delta") deltas++;
  else if (e.type === "assistant_done") done = e.text;
  else if (e.type === "rate_limit") console.log("RATE %s:%s", e.kind, e.status);
  else if (e.type === "result") { console.log("RESULT cost=$%s deltas=%d text=%j", e.costUsd, deltas, done.slice(0,60)); s.kill(); process.exit(0); }
});
s.spawn();
s.send("Reply with a single short sentence about summoning.");
