import { useCallback, useEffect, useRef, useState } from "react";
import { ClaudeSession, type SessionEvent, type Usage } from "../../session/claude-session.ts";
import { listSessions, loadTranscript } from "../../domain/sessions.ts";
import { routeMessage, enqueue, drain, type QueueItem } from "../../domain/queue.ts";
import type { ImageBlock } from "../../domain/content.ts";
import { buildTitle, titleLabel, titleSequence } from "../../domain/title.ts";
import { generateTitle } from "../../domain/title-gen.ts";
import { saveTitle } from "../../title-store.ts";
import { SPINNER, ZERO, PROJECT, toolActivity, toolLine, type Turn, type Ask, type Role } from "../constants.ts";
import type { AskAnswer } from "../../domain/ask.ts";
import { relPath, fileTurnText, foldFileEdit } from "../../domain/file-edits.ts";
import { useAttention } from "./useAttention.ts";
import type { AttentionReason } from "../../domain/attention.ts";
import { terminalNotifierHint } from "../../domain/notify.ts";

// File-mutating tools already get a nicer "EDIT ✎ path +N −M" row via the file_change
// event, so we don't also add a plain TOOL trace row for them (would double up).
const MUTATING = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// Squeeze a tool target onto one transcript line: cwd-relative, whitespace collapsed
// (multi-line Bash commands become one line), and capped so it never wraps the pane.
const shortTarget = (detail: string) => {
  let x = detail.replace(/\s+/g, " ").trim();
  const cwd = process.cwd() + "/";
  if (x.startsWith(cwd)) x = x.slice(cwd.length);
  return x.length > 60 ? x.slice(0, 59) + "…" : x;
};

/**
 * The conversation engine: owns the live ClaudeSession, the stream-event reducer, all
 * turn/streaming/usage state, the ~16fps flush timer, the terminal-title effects, and
 * the message queue + drain. Everything about talking to claude lives here; the UI
 * layer consumes the returned state and calls the returned actions.
 */
export function useConversation() {
  const sessionRef = useRef<ClaudeSession | null>(null);
  const accRef = useRef(""); // streaming answer buffer, flushed on a timer
  const thinkRef = useRef(""); // streaming thinking buffer
  const usageRef = useRef<Usage>(ZERO); // live turn usage
  const activityRef = useRef(""); // ephemeral "what claude is doing" (current tool)
  const dirtyRef = useRef(false);
  const thinkDirtyRef = useRef(false);
  const usageDirtyRef = useRef(false);
  const activityDirtyRef = useRef(false);
  const modelRef = useRef<string | undefined>(undefined); // last chosen model, kept across /new
  const titleFiredRef = useRef(false); // one-shot guard for the title generation call
  const sessionIdRef = useRef(""); // full id of the live session, for persisting its title

  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState("");
  const [thinking, setThinking] = useState("");
  const [busy, setBusy] = useState(false);
  // Messages typed (or skill prompts) while busy, sent FIFO as turns free up. `wire`
  // is what claude receives; `display` is the (possibly shorter) transcript label.
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState<Usage>(ZERO); // current-turn token counts
  const [activity, setActivity] = useState(""); // ephemeral status label (current tool)
  const [sessionTok, setSessionTok] = useState<Usage>(ZERO);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState({ model: "—", cost: 0, session: "—" });
  const [genTitle, setGenTitle] = useState(""); // model-named session title (empty until generated)
  // AskUserQuestion state. It lives here (not in useAskFlow) because the stable onEvent
  // reducer must be able to set it, and only useState setters are stable enough to be
  // captured by a `useCallback([])`. useAskFlow builds the handlers over this state.
  const [ask, setAsk] = useState<Ask | null>(null); // active AskUserQuestion prompt
  const [askIdx, setAskIdx] = useState(0); // which question we're on (multi-question)
  const [otherMode, setOtherMode] = useState(false); // typing a custom "Other" answer
  const askAnsRef = useRef<AskAnswer[]>([]);

  // Attention-seeking: nudge the user (bell + toast + tab-title bell) when a turn blocks or
  // finishes while they're on another window. onEvent is a stable `useCallback([])`, so it
  // reaches `seek` and the current tab label through refs rather than capturing them.
  const attention = useAttention();
  const seekRef = useRef<(reason: AttentionReason, label: string) => void>(() => {});
  seekRef.current = attention.seek;
  const labelRef = useRef(PROJECT); // latest tab label (chat name), kept fresh by the title effect

  const pushSys = (text: string) => setTurns((p) => [...p, { role: "sys", text }]);

  // Stable event handler — reads/writes only refs + stable setState fns.
  const onEvent = useCallback((e: SessionEvent) => {
    switch (e.type) {
      case "init":
        sessionIdRef.current = e.sessionId;
        setStatus((p) => ({ ...p, model: e.model, session: e.sessionId.slice(0, 8) }));
        break;
      case "delta":
        accRef.current += e.text;
        dirtyRef.current = true;
        // Claude resumed writing — the prior tool label is stale, drop it.
        if (activityRef.current) { activityRef.current = ""; activityDirtyRef.current = true; }
        break;
      case "thinking":
        thinkRef.current += e.text;
        thinkDirtyRef.current = true;
        if (activityRef.current) { activityRef.current = ""; activityDirtyRef.current = true; }
        break;
      case "tool": {
        const target = shortTarget(e.detail);
        activityRef.current = toolActivity(e.name, target);
        activityDirtyRef.current = true;
        // Persist a compact trace row so the user can scroll back and see what Claude
        // actually did (which files it read, commands it ran), like Claude Code's tool
        // list. Mutating tools are skipped — they get the richer EDIT row instead.
        if (!MUTATING.has(e.name)) setTurns((p) => [...p, { role: "tool", text: toolLine(e.name, target) }]);
        break;
      }
      case "usage":
        usageRef.current = e.usage;
        usageDirtyRef.current = true;
        break;
      case "assistant_done":
        setTurns((p) => [...p, { role: "claude", text: e.text }]);
        accRef.current = "";
        thinkRef.current = "";
        dirtyRef.current = false;
        thinkDirtyRef.current = false;
        setStreaming("");
        setThinking("");
        break;
      case "result":
        setStatus((p) => ({ ...p, cost: e.costUsd }));
        setSessionTok((p) => ({
          input: p.input + e.usage.input,
          output: p.output + e.usage.output,
          cacheRead: p.cacheRead + e.usage.cacheRead,
          cacheCreate: p.cacheCreate + e.usage.cacheCreate,
        }));
        usageRef.current = ZERO;
        activityRef.current = "";
        setLive(ZERO);
        setActivity("");
        setBusy(false);
        seekRef.current("done", labelRef.current); // turn finished — nudge if the user stepped away
        break;
      case "available_models":
        if (e.models.length) setModels(e.models);
        break;
      case "file_change": {
        const edit = { rel: relPath(e.path, process.cwd()), added: e.added, removed: e.removed, kind: e.kind };
        // A write (unknown removals) gets the WRITE label; an edit gets EDIT. Distinct
        // roles also keep the two from grouping under one header when interleaved.
        const role: Role = e.kind === "write" ? "write" : "file";
        setTurns((p) => {
          // Fold into the previous row when it's the same kind of change to the same file,
          // so a run of edits to one file stays a single updating entry instead of piling up.
          const last = p[p.length - 1];
          const merged = last?.role === role ? foldFileEdit(last.file, edit) : null;
          const row: Turn = merged
            ? { role, text: fileTurnText(merged), file: merged }
            : { role, text: fileTurnText(edit), file: edit };
          return merged ? [...p.slice(0, -1), row] : [...p, row];
        });
        break;
      }
      case "ask":
        askAnsRef.current = [];
        setAskIdx(0);
        setOtherMode(false);
        setAsk({ requestId: e.requestId, questions: e.questions });
        seekRef.current("blocked", labelRef.current); // blocked on the user — nudge if they stepped away
        break;
      case "control":
        setTurns((p) => [...p, { role: "err", text: `unsupported control request: ${e.subtype} (auto-continued, not hung)` }]);
        break;
      case "error":
        setTurns((p) => [...p, { role: "err", text: e.message }]);
        break;
      case "exit":
        setBusy(false);
        break;
    }
  }, []);

  const startSession = useCallback((opts: { resume?: string; continueLast?: boolean; model?: string } = {}) => {
    sessionRef.current?.kill();
    accRef.current = "";
    thinkRef.current = "";
    usageRef.current = ZERO;
    activityRef.current = "";
    dirtyRef.current = thinkDirtyRef.current = usageDirtyRef.current = activityDirtyRef.current = false;
    setStreaming("");
    setThinking("");
    setLive(ZERO);
    setActivity("");
    setQueue([]); // fresh session — drop anything queued against the old one
    setGenTitle(""); // fresh session — regenerate the tab title from its first exchange
    titleFiredRef.current = false;
    sessionIdRef.current = ""; // init event fills this in for the new session
    const s = new ClaudeSession();
    s.on("event", onEvent);
    sessionRef.current = s;
    s.spawn({ ...opts, model: opts.model ?? modelRef.current });
  }, [onEvent]);

  useEffect(() => {
    startSession();
    return () => sessionRef.current?.kill();
  }, [startSession]);

  // One-time hint: on macOS without terminal-notifier, mention how to enable notification
  // click-to-focus. Shown once at startup; notifications themselves need no such install.
  useEffect(() => {
    const hint = terminalNotifierHint(process.platform, Bun.which("terminal-notifier") != null);
    if (hint) pushSys(hint);
  }, []);

  // One animation timer while busy: advances the spinner AND flushes the streaming /
  // thinking / usage buffers at ~16fps instead of re-rendering on every token.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => {
      setTick((n) => n + 1);
      if (dirtyRef.current) { setStreaming(accRef.current); dirtyRef.current = false; }
      if (thinkDirtyRef.current) { setThinking(thinkRef.current); thinkDirtyRef.current = false; }
      if (usageDirtyRef.current) { setLive(usageRef.current); usageDirtyRef.current = false; }
      if (activityDirtyRef.current) { setActivity(activityRef.current); activityDirtyRef.current = false; }
    }, 60);
    return () => clearInterval(id);
  }, [busy]);

  // Terminal tab title — a filled dot while a turn runs, a glyph when idle, plus the
  // chat name (first thing the user asked). Lets you tell open Summon terminals apart
  // and see at a glance which one is working, like Claude Code's own title. On unmount
  // reset to just the project name so the tab isn't left mid-run.
  useEffect(() => {
    const label = genTitle || titleLabel(turns.find((x) => x.role === "you")?.text, PROJECT);
    labelRef.current = label; // keep the label onEvent hands to seek() current
    process.stdout.write(titleSequence(buildTitle({ busy, label, attention: attention.attention })));
  }, [busy, turns, genTitle, attention.attention]);
  useEffect(() => () => { process.stdout.write(titleSequence(PROJECT)); }, []);

  // Once the first exchange is on screen, ask a cheap model to name the session so
  // the tab shows the actual intent, not just the truncated first message. Fired
  // exactly once (titleFiredRef); the truncated fallback stays until it resolves.
  useEffect(() => {
    if (titleFiredRef.current) return;
    const firstUser = turns.find((x) => x.role === "you")?.text;
    const firstClaude = turns.find((x) => x.role === "claude")?.text;
    if (!firstUser || !firstClaude) return;
    titleFiredRef.current = true;
    const sid = sessionIdRef.current;
    generateTitle(firstUser, firstClaude).then((t) => {
      if (!t) return;
      setGenTitle(t);
      saveTitle(sid, t); // persist so /resume shows this name, not the raw first message
    });
  }, [turns]);

  // Actually hand a message to the running session and mark the turn busy. `wire`
  // goes to claude; `display` (defaults to wire) is the transcript label.
  const sendNow = (wire: string, display = wire, images?: ImageBlock[]) => {
    attention.clear(); // user's back and acting on it — drop any pending/active nudge
    setTurns((p) => [...p, { role: "you", text: display }]);
    accRef.current = "";
    thinkRef.current = "";
    usageRef.current = ZERO;
    activityRef.current = "";
    setStreaming("");
    setThinking("");
    setLive(ZERO);
    setActivity("");
    setBusy(true);
    sessionRef.current?.send(wire, images);
  };

  // Drain the queue: once a turn finishes (busy → false), send the next queued
  // message. Sending flips busy back to true, so exactly one drains per turn.
  useEffect(() => {
    const d = drain(busy, queue);
    if (!d) return;
    setQueue(d.rest);
    sendNow(d.next.wire, d.next.display, d.next.images);
  }, [busy, queue]);

  // Route an outgoing message: if a turn is in flight it queues (drained later),
  // otherwise it sends immediately. Shared by typed input and skill prompts.
  const enqueueOrSend = (wire: string, display = wire, images?: ImageBlock[]) => {
    const r = routeMessage(busy, { wire, display, images });
    if (r.action === "queue") { setQueue((q) => enqueue(q, r.item)); return; }
    sendNow(wire, display, images);
  };

  // Esc while busy: abort the current turn. Flush whatever streamed so far into a
  // turn so the partial answer isn't lost, then hand control back to the user. The
  // CLI's follow-up `result` event just no-ops (busy already false).
  const interrupt = () => {
    if (!busy) return;
    attention.clear(); // user took control — drop any pending/active nudge
    sessionRef.current?.interrupt();
    const partial = accRef.current;
    if (partial) setTurns((p) => [...p, { role: "claude", text: partial }]);
    accRef.current = "";
    thinkRef.current = "";
    activityRef.current = "";
    dirtyRef.current = thinkDirtyRef.current = activityDirtyRef.current = false;
    setStreaming("");
    setThinking("");
    setActivity("");
    setBusy(false);
    pushSys("interrupted — turn stopped.");
  };

  const clear = () => setTurns([]);

  const newSession = () => {
    setTurns([]);
    setSessionTok(ZERO);
    pushSys("started a fresh session.");
    startSession();
  };

  const resume = (id?: string) => {
    const cwd = process.cwd();
    // Resolve "continue latest" to a concrete id so we can load its transcript.
    const target = id ?? listSessions(cwd, 1)[0]?.id;
    if (!target) { setTurns([]); pushSys("no past session to continue in this directory."); startSession(); return; }
    setTurns(loadTranscript(target, cwd)); // replay history so it's not a blank screen
    pushSys(`resumed session ${target.slice(0, 8)} — history restored`);
    startSession({ resume: target });
  };

  const setModelRuntime = (alias: string) => {
    modelRef.current = alias;
    sessionRef.current?.setModel(alias); // runtime switch, keeps context
    setStatus((p) => ({ ...p, model: alias }));
    pushSys(`switching model → ${alias}…`);
  };

  const killSession = () => sessionRef.current?.kill();
  const answerQuestion = (requestId: string, message: string) => {
    attention.clear(); // user answered the blocked prompt — the session no longer needs them
    return sessionRef.current?.answerQuestion(requestId, message);
  };

  const spin = SPINNER[tick % SPINNER.length]!; // index is always in range

  return {
    // state
    turns, streaming, thinking, busy, queue, live, activity, sessionTok, models, status, genTitle, spin,
    // AskUserQuestion state (handlers are composed in useAskFlow)
    ask, setAsk, askIdx, setAskIdx, otherMode, setOtherMode, askAnsRef,
    // actions
    pushSys, enqueueOrSend, interrupt, clear, newSession, resume, setModelRuntime, killSession, answerQuestion,
  };
}
