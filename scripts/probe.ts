// Edge-case probe harness. Runs a series of scenarios against a real ClaudeSession
// and reports which events fire — so we can verify behaviour (and discover unknown
// protocol shapes like AskUserQuestion / elicitation) headlessly instead of eyeballing
// the TUI. Run: bun run scripts/probe.ts   (bills the subscription — makes real calls)

import { ClaudeSession, type SessionEvent, type AskQuestion } from "../src/session/claude-session.ts";

type Scenario = {
  name: string;
  prompt: string;
  spawn?: { model?: string };
  preSend?: (s: ClaudeSession) => void; // runs right after spawn, before the prompt
  answer?: (q: AskQuestion) => string; // for AskUserQuestion: what to answer (default: first option)
  timeoutMs?: number;
};

// NOTE: the interactive claude does not emit system:init until it receives the first
// stdin message — so we always send the prompt immediately after spawn (never wait for init).
const SCENARIOS: Scenario[] = [
  { name: "basic streaming", prompt: "Reply with one short sentence about summoning." },
  { name: "read tool (auto-approved)", prompt: "Read the file package.json in the cwd and tell me its \"name\" field. Use the Read tool." },
  { name: "write tool (auto-approved)", prompt: "Create a file summon_probe_delete_me.txt containing 'hi' using the Write tool, then say done." },
  { name: "AskUserQuestion attempt", prompt: "Use the AskUserQuestion tool to ask me whether I prefer cats or dogs. Present it as an interactive choice." },
  { name: "typeable 'Other' answer", prompt: "Use the AskUserQuestion tool to ask my favorite color with options Red, Blue, Green. After I answer, repeat my exact answer back in one sentence.", answer: () => "Chartreuse (typed via Other)" },
  { name: "runtime model switch", prompt: "Say your model family in one word.", preSend: (s) => s.setModel("claude-sonnet-4-6") },
  { name: "forced error (bad model)", prompt: "hi", spawn: { model: "totally-not-a-real-model-xyz" } },
];

function runScenario(sc: Scenario): Promise<void> {
  return new Promise((resolve) => {
    const s = new ClaudeSession();
    const counts: Record<string, number> = {};
    const notable: string[] = [];
    let finished = false;

    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      s.kill();
      console.log(`\n■ ${sc.name}`);
      console.log(`  events: ${JSON.stringify(counts)}`);
      for (const n of notable) console.log(`  ${n}`);
      setTimeout(resolve, 400); // let the child die before the next spawn
    };

    const timer = setTimeout(() => { notable.push("⚠ TIMEOUT (no result within budget)"); done(); }, sc.timeoutMs ?? 60000);

    s.on("event", (e: SessionEvent) => {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      switch (e.type) {
        case "init":
          notable.push(`init: model=${e.model} auth=${e.apiKeySource}`);
          break;
        case "tool":
          notable.push(`TOOL invoked: ${e.name}`);
          break;
        case "ask": {
          const q = e.questions[0]!;
          const label = sc.answer ? sc.answer(q) : q.options[0]!.label;
          notable.push(`ASK: ${q.header} [${q.options.map((o) => o.label).join(", ")}] — answering "${label}"`);
          s.answerQuestion(e.requestId, `The user selected — ${q.header}: ${label}`);
          break;
        }
        case "control":
          notable.push(`CONTROL(${e.subtype}) RAW: ${JSON.stringify(e.raw).slice(0, 300)}`);
          break;
        case "error":
          notable.push(`ERROR: ${e.message}`);
          break;
        case "assistant_done":
          notable.push(`answer: ${JSON.stringify(e.text.slice(0, 70))}`);
          break;
        case "result":
          notable.push(`result: cost=$${e.costUsd.toFixed(4)} in=${e.usage.input} out=${e.usage.output}`);
          done();
          break;
      }
    });
    s.spawn(sc.spawn ?? {});
    sc.preSend?.(s);
    s.send(sc.prompt); // send immediately — init only fires after the first message
  });
}

const only = process.argv[2]; // optional: run one scenario by index
console.log("Summon probe — real subscription calls. Scenarios:", SCENARIOS.length);
for (let i = 0; i < SCENARIOS.length; i++) {
  if (only !== undefined && String(i) !== only) continue;
  await runScenario(SCENARIOS[i]!);
}
console.log("\n✔ probe complete");
process.exit(0);
