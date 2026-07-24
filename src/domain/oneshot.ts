// Shared throwaway one-shot Claude call. Both chat-title generation (title-gen.ts) and
// the /ask quick-answer command (quick-ask.ts) need to fire a single prompt at a cheap
// model and read one reply WITHOUT touching the main interactive session.
//
// IMPORTANT: we do NOT use `claude -p` / --print here. That path routes to the SDK /
// credit pool / API key, which is exactly what this project avoids (see the header of
// claude-session.ts). We spawn a throwaway *interactive* stream-json claude — the same
// subscription-billed path (apiKeySource=none) the main chat uses — write one prompt on
// stdin, read the final `result` event off stdout, then kill it.
//
// Two Bun/CLI quirks this works around, both of which silently swallowed the reply:
//   1. We write the prompt to stdin *immediately* — claude keeps its stdout buffered
//      until it receives input, so waiting for the `init` event first deadlocks.
//   2. We parse stdout with a raw `data` handler + manual line-splitting rather than
//      node:readline, whose createInterface over a child pipe can stall after the
//      first line in a non-TTY context.
// We read until the `result` event, whose `result` field is the full reply text.

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolveClaudeLaunch } from "./claude-bin.ts";

const BASE_ARGS = [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--permission-prompt-tool", "stdio",
];

/**
 * Fire one `prompt` at `model` on the throwaway subscription-billed path and resolve
 * the raw `result` text — or null on any failure/timeout (caller keeps a fallback).
 */
export function runOneShot(
  prompt: string,
  opts: { model: string; timeoutMs?: number },
): Promise<string | null> {
  const { model, timeoutMs = 30000 } = opts;

  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    let done = false;
    let proc: ReturnType<typeof spawn> | null = null;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { proc?.kill("SIGTERM"); } catch {}
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      const { command, shell } = resolveClaudeLaunch();
      // Run in the OS temp dir, NOT process.cwd(): a throwaway interactive claude persists
      // its own <id>.jsonl under ~/.claude/projects/<cwd>/. If that were the real project
      // dir, every /ask (and title-gen) call would litter the /resume picker with a phantom
      // session (listSessions reads every .jsonl there). tmpdir keeps them out of it, and
      // the prompt already carries all needed context as text — no tools/cwd required.
      proc = spawn(command, [...BASE_ARGS, "--model", model], {
        stdio: ["pipe", "pipe", "ignore"],
        env,
        cwd: tmpdir(),
        shell,
      });
      // If the resolved binary still can't be exec'd, don't hang — caller falls back.
      proc.on("error", () => finish(null));
    } catch {
      return finish(null);
    }

    // Send the prompt up front (see quirk #1) — the message queues until the session
    // is ready, then claude flushes its stream and processes it.
    proc.stdin!.write(
      JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } }) + "\n",
    );

    let buf = "";
    proc.stdout!.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let json: any;
        try { json = JSON.parse(line); } catch { continue; }
        if (json.type === "result") finish(typeof json.result === "string" ? json.result : null);
      }
    });
    proc.on("error", () => finish(null));
    proc.on("close", () => finish(null)); // closed before a result → keep the fallback
  });
}
