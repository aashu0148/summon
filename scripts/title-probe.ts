// Diagnostic: does OSC title-setting reach *this* terminal?
// Run directly (NOT through the TUI):  bun run scripts/title-probe.ts
// Watch the tab title. If it cycles through the messages below, OSC works and the
// problem is the VS Code tabs.title template. If it never changes, VS Code is
// swallowing/overriding the sequence (shell integration or template).

const osc = (t: string) => `\x1b]0;${t}\x07\x1b]2;${t}\x07`;

const msgs = ["● PROBE running", "✳ PROBE idle", "● PROBE step 2", "✳ PROBE done"];
let i = 0;

console.log(`isTTY=${process.stdout.isTTY} TERM_PROGRAM=${process.env.TERM_PROGRAM}`);
console.log("Watch the tab title for ~8s. Ctrl+C to stop.");

const id = setInterval(() => {
  const m = msgs[i % msgs.length];
  process.stdout.write(osc(m));
  console.log(`set: ${m}`);
  if (++i >= msgs.length) clearInterval(id);
}, 2000);
