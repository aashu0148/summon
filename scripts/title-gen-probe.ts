import { ClaudeSession } from "../src/claude-session.ts";

const s = new ClaudeSession();
s.on("event", (e: any) => console.log("EVENT", e.type));
console.log("spawning...");
try {
  s.spawn({ model: "claude-haiku-4-5" });
  console.log("spawn returned");
} catch (err) {
  console.log("spawn threw", err);
}
setTimeout(() => { console.log("still alive after 3s"); }, 3000);
setTimeout(() => { console.log("TIMEOUT"); s.kill(); process.exit(1); }, 15000);
