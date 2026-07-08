import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { buildUserContent, type ImageBlock } from "../domain/content.ts";

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

/**
 * A short human "target" for a tool call — the file it reads, the command it runs, the
 * pattern it searches — pulled from the tool's input. Lets the UI show "reading
 * src/foo.ts" and a persistent trace row instead of a bare "reading a file". Returns ""
 * when the tool has no single meaningful target (the UI falls back to a generic verb).
 */
export function toolTarget(name: string, input: any): string {
  const s = (v: any) => (typeof v === "string" ? v : "");
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      return s(input?.file_path);
    case "NotebookEdit":
      return s(input?.notebook_path) || s(input?.file_path);
    case "Bash":
      return s(input?.command);
    case "Grep":
    case "Glob":
      return s(input?.pattern);
    case "LS":
      return s(input?.path);
    case "WebFetch":
      return s(input?.url);
    case "WebSearch":
      return s(input?.query);
    case "Task":
      return s(input?.description) || s(input?.subagent_type);
    default:
      return "";
  }
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
  | { type: "tool"; name: string; detail: string }  // a tool was invoked (auto-approved); detail = its target
  | { type: "file_change"; path: string; added: number; removed: number } // a file was written/edited
  | { type: "ask"; requestId: string; questions: AskQuestion[] } // AskUserQuestion — needs the user to pick
  | { type: "control"; subtype: string; raw: any }  // unhandled control request (surfaced, not hung)
  | { type: "error"; message: string }
  | { type: "exit"; code: number | null };

const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheCreate: a.cacheCreate + b.cacheCreate,
});

export class ClaudeSession extends EventEmitter {
  private proc: ChildProcess | null = null;
  private seenToolUse = new Set<string>(); // dedupe file_change across repeated assistant frames
  // Live token accounting for the current turn. A single turn produces MANY assistant
  // messages once tools are involved, and each `message_start` restarts output_tokens at
  // ~1 while `message_delta` reports only output_tokens (input absent). Emitting those raw
  // made the HUD counter collapse to 0 and climb again on every message. Instead we keep a
  // running total: `committed` = sum of finished messages this turn, `msg` = the in-flight
  // one; the emitted usage is always committed+msg, so it only ever grows within a turn.
  private committed: Usage = { ...ZERO_USAGE };
  private msg: Usage = { ...ZERO_USAGE };

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
          // Mutating tools get the richer "✎ path +N −M" file_change row; every other
          // tool (Read/Bash/Grep/…) surfaces as a `tool` event so the user can see what
          // Claude is doing. This is the reliable source — in the default auto-permission
          // mode the CLI just runs tools without ever sending a can_use_tool request.
          if (fc) this.emit("event", { type: "file_change", ...fc });
          else this.emit("event", { type: "tool", name: b.name, detail: toolTarget(b.name, b.input) });
        }
      }
      // The completed assistant frame carries the message's authoritative usage — fold it
      // into the in-flight message (max per field) so the running total is accurate.
      if (json.message?.usage) {
        const u = this.readUsage(json.message.usage);
        this.msg = {
          input: Math.max(u.input, this.msg.input),
          output: Math.max(u.output, this.msg.output),
          cacheRead: Math.max(u.cacheRead, this.msg.cacheRead),
          cacheCreate: Math.max(u.cacheCreate, this.msg.cacheCreate),
        };
        this.emitCumulative();
      }
    } else if (t === "rate_limit_event") {
      const info = json.rate_limit_info ?? {};
      this.emit("event", { type: "rate_limit", kind: info.rateLimitType ?? "?", status: info.status ?? "?" });
    } else if (t === "result") {
      const usage = this.readUsage(json.usage);
      this.resetTurnUsage(); // turn over — next turn's live counter starts clean
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
      // A new assistant message begins: bank the finished one, then seed the new one.
      this.committed = addUsage(this.committed, this.msg);
      this.msg = this.readUsage(ev.message?.usage);
      this.emitCumulative();
    } else if (ev.type === "message_delta") {
      // Progress for the in-flight message. Deltas usually carry only output_tokens, so
      // take the max per-field (never regress input/cache to 0 on a sparse delta).
      const u = this.readUsage(ev.usage);
      this.msg = {
        input: Math.max(u.input, this.msg.input),
        output: Math.max(u.output, this.msg.output),
        cacheRead: Math.max(u.cacheRead, this.msg.cacheRead),
        cacheCreate: Math.max(u.cacheCreate, this.msg.cacheCreate),
      };
      this.emitCumulative();
    }
  }

  /** Emit the running turn total (finished messages + the in-flight one) for the live HUD. */
  private emitCumulative(): void {
    this.emit("event", { type: "usage", usage: addUsage(this.committed, this.msg) });
  }

  /** Reset per-turn token accounting. Called when a new turn starts (send) or ends (result). */
  private resetTurnUsage(): void {
    this.committed = { ...ZERO_USAGE };
    this.msg = { ...ZERO_USAGE };
  }

  private readUsage(u: any): Usage {
    return {
      input: u?.input_tokens ?? 0,
      output: u?.output_tokens ?? 0,
      cacheRead: u?.cache_read_input_tokens ?? 0,
      cacheCreate: u?.cache_creation_input_tokens ?? 0,
    };
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
      // The `tool` activity event is emitted from the assistant frame's tool_use blocks
      // (the reliable path), not here — this request usually doesn't even fire in auto mode.
      this.writeControlResponse(rid, { behavior: "allow", updatedInput: req.input ?? {} });
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

  send(text: string, images: ImageBlock[] = []): void {
    const content = buildUserContent(text, images);
    if (!content.length) return; // nothing to send (empty text, no images)
    this.resetTurnUsage(); // new turn — start the live token counter from zero
    this.writeLine({ type: "user", message: { role: "user", content } });
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
