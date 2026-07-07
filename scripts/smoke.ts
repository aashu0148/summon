// Live smoke check — spawns the real `claude` CLI and makes ONE billed subscription
// call to confirm the end-to-end path works. NOT a unit test (bun test never runs it):
// it needs auth, the network, and costs money. The offline parsing tests live in
// src/claude-session.test.ts. Run: bun run smoke
import { ClaudeSession } from "../src/session/claude-session.ts";
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
