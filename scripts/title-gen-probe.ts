// Live probe for generateTitle — real (billed) subscription calls.
//   bun run scripts/title-gen-probe.ts
import { generateTitle } from "../src/domain/title-gen.ts";

const cases: [string, string][] = [
  ["Hey I want to refactor, are you up for that?", "Sure — what do you want to refactor?"],
  ["help me add a websocket endpoint to the bun server for live updates", "Which path should it listen on?"],
  ["the tests are flaky on CI, can you look", "Which tests? Do you have the CI logs?"],
];

for (const [u, a] of cases) {
  const title = await generateTitle(u, a);
  console.log(`user: ${JSON.stringify(u)}\n  -> ${JSON.stringify(title)}\n`);
}
process.exit(0);
