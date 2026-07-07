import { useCallback, useEffect, useRef, useState } from "react";
import { ClaudeSession, type SessionEvent, type Usage } from "../../session/claude-session.ts";
import { listSessions, loadTranscript } from "../../domain/sessions.ts";
import { routeMessage, enqueue, drain, type QueueItem } from "../../domain/queue.ts";
import { buildTitle, titleLabel, titleSequence } from "../../domain/title.ts";
import { generateTitle } from "../../domain/title-gen.ts";
import { saveTitle } from "../../title-store.ts";
import { SPINNER, ZERO, PROJECT, toolActivity, type Turn, type Ask } from "../constants.ts";

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
  const [sessionTok, setSessionTok] = useState({ input: 0, output: 0 });
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState({ model: "—", cost: 0, session: "—" });
  const [genTitle, setGenTitle] = useState(""); // model-named session title (empty until generated)
  // AskUserQuestion state. It lives here (not in useAskFlow) because the stable onEvent
  // reducer must be able to set it, and only useState setters are stable enough to be
  // captured by a `useCallback([])`. useAskFlow builds the handlers over this state.
  const [ask, setAsk] = useState<Ask | null>(null); // active AskUserQuestion prompt
  const [askIdx, setAskIdx] = useState(0); // which question we're on (multi-question)
  const [otherMode, setOtherMode] = useState(false); // typing a custom "Other" answer
  const askAnsRef = useRef<{ header: string; label: string }[]>([]);

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
      case "tool":
        activityRef.current = toolActivity(e.name);
        activityDirtyRef.current = true;
        break;
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
        setSessionTok((p) => ({ input: p.input + e.usage.input, output: p.output + e.usage.output }));
        usageRef.current = ZERO;
        activityRef.current = "";
        setLive(ZERO);
        setActivity("");
        setBusy(false);
        break;
      case "available_models":
        if (e.models.length) setModels(e.models);
        break;
      case "file_change": {
        const rel = e.path.startsWith(process.cwd() + "/") ? e.path.slice(process.cwd().length + 1) : e.path;
        setTurns((p) => [...p, { role: "file", text: `✎ ${rel}  +${e.added} −${e.removed}` }]);
        break;
      }
      case "ask":
        askAnsRef.current = [];
        setAskIdx(0);
        setOtherMode(false);
        setAsk({ requestId: e.requestId, questions: e.questions });
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
    process.stdout.write(titleSequence(buildTitle({ busy, label })));
  }, [busy, turns, genTitle]);
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
  const sendNow = (wire: string, display = wire) => {
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
    sessionRef.current?.send(wire);
  };

  // Drain the queue: once a turn finishes (busy → false), send the next queued
  // message. Sending flips busy back to true, so exactly one drains per turn.
  useEffect(() => {
    const d = drain(busy, queue);
    if (!d) return;
    setQueue(d.rest);
    sendNow(d.next.wire, d.next.display);
  }, [busy, queue]);

  // Route an outgoing message: if a turn is in flight it queues (drained later),
  // otherwise it sends immediately. Shared by typed input and skill prompts.
  const enqueueOrSend = (wire: string, display = wire) => {
    const r = routeMessage(busy, { wire, display });
    if (r.action === "queue") { setQueue((q) => enqueue(q, r.item)); return; }
    sendNow(wire, display);
  };

  // Esc while busy: abort the current turn. Flush whatever streamed so far into a
  // turn so the partial answer isn't lost, then hand control back to the user. The
  // CLI's follow-up `result` event just no-ops (busy already false).
  const interrupt = () => {
    if (!busy) return;
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
    setSessionTok({ input: 0, output: 0 });
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
  const answerQuestion = (requestId: string, message: string) => sessionRef.current?.answerQuestion(requestId, message);

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
