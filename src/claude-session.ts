import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

/**
 * Minimal "summoner core", distilled from Code Quest's ProcessRunner +
 * ChildProcessProvider + ClaudeProtocol. Spawns the *interactive* claude CLI
 * (no --print) speaking stream-json over stdio, parses the NDJSON event stream,
 * and re-emits typed events. This is the exact path that bills to the Pro/Max
 * subscription (apiKeySource=none, five_hour rate limit) rather than the SDK
 * credit pool. Protocol reference: docs/claude-protocol-notes.md.
 */

// Exact args from Code Quest's ClaudeProtocol.baseArgs (interactive, no --print).
const BASE_ARGS = [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--permission-prompt-tool", "stdio",
  "--include-partial-messages",
  "--include-hook-events",
  "--replay-user-messages",
];

export type Usage = { input: number; output: number; cacheRead: number; cacheCreate: number };

export type FileChange = { path: string; added: number; removed: number };

/**
 * Derive a file-change summary (path + lines added/removed) from a file-mutating
 * tool's input. Shared by the live session and transcript replay so both render the
 * same "✎ path +N -M" line. Returns null for non-mutating tools.
 */
export function fileChangeFromToolUse(name: string, input: any): FileChange | null {
  const lines = (s: any) => (typeof s === "string" && s.length ? s.split("\n").length : 0);
  if (name === "Write") return { path: input?.file_path ?? "?", added: lines(input?.content), removed: 0 };
  if (name === "Edit") return { path: input?.file_path ?? "?", added: lines(input?.new_string), removed: lines(input?.old_string) };
  if (name === "MultiEdit") {
    let added = 0, removed = 0;
    for (const e of input?.edits ?? []) { added += lines(e?.new_string); removed += lines(e?.old_string); }
    return { path: input?.file_path ?? "?", added, removed };
  }
  if (name === "NotebookEdit") return { path: input?.notebook_path ?? input?.file_path ?? "?", added: lines(input?.new_source), removed: 0 };
  return null;
}

// AskUserQuestion tool input — the interactive "pick an option" prompt.
export type AskQuestion = {
  question: string;
  header: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
};

export type SessionEvent =
  | { type: "init"; sessionId: string; model: string; apiKeySource: string }
  | { type: "delta"; text: string }                 // streamed assistant token
  | { type: "thinking"; text: string }              // streamed thinking token
  | { type: "assistant_done"; text: string }        // full assistant turn
  | { type: "usage"; usage: Usage }                  // live token counts for the current turn
  | { type: "rate_limit"; kind: string; status: string }
  | { type: "result"; costUsd: number; ms: number; text: string; usage: Usage }
  | { type: "available_models"; models: string[] }
  | { type: "tool"; name: string }                  // a tool was invoked (auto-approved)
  | { type: "file_change"; path: string; added: number; removed: number } // a file was written/edited
  | { type: "ask"; requestId: string; questions: AskQuestion[] } // AskUserQuestion — needs the user to pick
  | { type: "control"; subtype: string; raw: any }  // unhandled control request (surfaced, not hung)
  | { type: "error"; message: string }
  | { type: "exit"; code: number | null };

export class ClaudeSession extends EventEmitter {
  private proc: ChildProcess | null = null;
  private seenToolUse = new Set<string>(); // dedupe file_change across repeated assistant frames

  override emit(event: "event", e: SessionEvent): boolean {
    return super.emit(event, e);
  }
  override on(event: "event", fn: (e: SessionEvent) => void): this {
    return super.on(event, fn);
  }

  spawn(opts: { resume?: string; continueLast?: boolean; model?: string } = {}): void {
    if (this.proc) return;
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = "true";

    // resume/continue/model are launch flags, not stdin messages (see docs/claude-protocol-notes.md).
    const args = [...BASE_ARGS];
    if (opts.resume) args.push("--resume", opts.resume);
    else if (opts.continueLast) args.push("--continue");
    if (opts.model) args.push("--model", opts.model);

    // cwd = the directory `summon` was launched from, so the spawned claude
    // operates on the user's current project (drop-in Claude Code launcher).
    const proc = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"], env, cwd: process.cwd() });
    this.proc = proc;

    createInterface({ input: proc.stdout! }).on("line", (line) => this.handleLine(line));
    // Don't swallow stderr — surface it as errors (prefixed).
    createInterface({ input: proc.stderr! }).on("line", (line) => {
      const s = line.trim();
      if (s) this.emit("event", { type: "error", message: `stderr: ${s}` });
    });
    proc.on("close", (code) => this.emit("event", { type: "exit", code }));
    proc.on("error", (err) => {
      this.emit("event", { type: "error", message: `spawn failed: ${err.message}` });
      this.emit("event", { type: "exit", code: -1 });
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let json: any;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return; // non-JSON noise
    }
    const t = json?.type;

    if (t === "system" && json.subtype === "init") {
      this.emit("event", { type: "init", sessionId: json.session_id, model: json.model, apiKeySource: json.apiKeySource });
    } else if (t === "stream_event") {
      this.handleStreamEvent(json.event);
    } else if (t === "assistant") {
      const content = json.message?.content ?? [];
      const text = content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (text) this.emit("event", { type: "assistant_done", text });
      // Surface file writes/edits from tool_use blocks (auto-approve mode never sends
      // us a can_use_tool for these). Dedupe by id since assistant frames can repeat.
      for (const b of content) {
        if (b?.type === "tool_use" && b.id && !this.seenToolUse.has(b.id)) {
          this.seenToolUse.add(b.id);
          const fc = fileChangeFromToolUse(b.name, b.input);
          if (fc) this.emit("event", { type: "file_change", ...fc });
        }
      }
      this.emitUsage(json.message?.usage);
    } else if (t === "rate_limit_event") {
      const info = json.rate_limit_info ?? {};
      this.emit("event", { type: "rate_limit", kind: info.rateLimitType ?? "?", status: info.status ?? "?" });
    } else if (t === "result") {
      const usage = this.readUsage(json.usage);
      this.emit("event", { type: "result", costUsd: json.total_cost_usd ?? 0, ms: json.duration_ms ?? 0, text: json.result ?? "", usage });
      if (json.is_error || (json.subtype && json.subtype !== "success") || (json.errors?.length)) {
        const msg = (json.errors ?? []).join("; ") || json.subtype || "turn ended with an error";
        this.emit("event", { type: "error", message: msg });
      }
    } else if (t === "available_models") {
      this.emit("event", { type: "available_models", models: json.models ?? [] });
    } else if (t === "error") {
      this.emit("event", { type: "error", message: json.error?.message ?? "unknown error" });
    } else if (t === "control_request") {
      this.handleControlRequest(json);
    }
    // control_response / control_cancel_request / keep_alive / hooks: ignored for now.
  }

  private handleStreamEvent(ev: any): void {
    if (!ev) return;
    if (ev.type === "content_block_delta") {
      if (ev.delta?.type === "text_delta") this.emit("event", { type: "delta", text: ev.delta.text ?? "" });
      else if (ev.delta?.type === "thinking_delta") this.emit("event", { type: "thinking", text: ev.delta.thinking ?? "" });
    } else if (ev.type === "message_start") {
      this.emitUsage(ev.message?.usage);
    } else if (ev.type === "message_delta") {
      this.emitUsage(ev.usage);
    }
  }

  private readUsage(u: any): Usage {
    return {
      input: u?.input_tokens ?? 0,
      output: u?.output_tokens ?? 0,
      cacheRead: u?.cache_read_input_tokens ?? 0,
      cacheCreate: u?.cache_creation_input_tokens ?? 0,
    };
  }

  private emitUsage(u: any): void {
    if (!u) return;
    this.emit("event", { type: "usage", usage: this.readUsage(u) });
  }

  private handleControlRequest(json: any): void {
    const rid: string = json.request_id;
    const req = json.request ?? {};
    const sub: string = req.subtype;

    if (sub === "can_use_tool") {
      const tool: string = req.tool_name ?? "?";
      // AskUserQuestion is the interactive "pick an option" prompt. Don't auto-allow
      // (that reads as "dismissed"); surface the questions and wait for the user's pick.
      if (tool === "AskUserQuestion") {
        const questions: AskQuestion[] = req.input?.questions ?? [];
        if (questions.length) {
          this.emit("event", { type: "ask", requestId: rid, questions });
          return;
        }
      }
      // Every other tool: auto-approve — permission policy is the underlying claude's
      // job (it runs in --permission-mode auto by default), not ours. We never prompt.
      this.writeControlResponse(rid, { behavior: "allow", updatedInput: req.input ?? {} });
      this.emit("event", { type: "tool", name: tool });
      return;
    }
    if (sub === "initialize") return; // no response required

    // Anything else: surface it (don't swallow) and answer with a safe default so the
    // CLI never blocks forever. We iterate on real subtypes as we observe them.
    this.emit("event", { type: "control", subtype: sub ?? "?", raw: json });
    this.writeControlResponse(rid, { continue: true });
  }

  /**
   * Answer an AskUserQuestion prompt. The reliable channel (verified via probe) is a
   * `deny` whose `message` carries the selection — Claude reads it as the user's answer
   * and continues. `interrupt:false` keeps the turn going.
   */
  answerQuestion(requestId: string, message: string): void {
    this.writeControlResponse(requestId, { behavior: "deny", message, interrupt: false });
  }

  /** Switch model at runtime via an outbound control_request (no re-spawn). */
  setModel(model: string): void {
    const request_id = randomUUID();
    this.writeLine({ request_id, type: "control_request", request: { subtype: "set_model", model } });
  }

  /**
   * Stop the current turn mid-flight (the Esc-to-interrupt behavior). Sends the
   * stream-json `interrupt` control request — claude aborts the in-progress
   * response and emits a `result`, keeping the session alive for the next message.
   */
  interrupt(): void {
    const request_id = randomUUID();
    this.writeLine({ request_id, type: "control_request", request: { subtype: "interrupt" } });
  }

  private writeControlResponse(requestId: string, inner: Record<string, unknown>): void {
    this.writeLine({ type: "control_response", response: { subtype: "success", request_id: requestId, response: inner } });
  }

  send(text: string): void {
    this.writeLine({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
  }

  private writeLine(obj: unknown): void {
    this.proc?.stdin?.write(JSON.stringify(obj) + "\n");
  }

  kill(): void {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    proc.kill("SIGTERM");
    // Force-kill if it doesn't exit promptly (notes §1: SIGTERM then SIGKILL).
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 3000);
    proc.on("close", () => clearTimeout(timer));
  }
}
