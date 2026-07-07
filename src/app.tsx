import { useCallback, useEffect, useRef, useState } from "react";
import { homedir } from "node:os";
import { useKeyboard, useRenderer } from "@opentui/react";
import { defaultTextareaKeyBindings } from "@opentui/core";
import { ClaudeSession, type SessionEvent, type Usage, type AskQuestion } from "./claude-session.ts";
import { THEMES, THEME_NAMES, getTheme, shortModel, type Theme } from "./theme.ts";
import { loadConfig, saveConfig } from "./config.ts";
import { COMMANDS, dispatchCommand, type CommandCtx } from "./commands.ts";
import { listSessions, loadTranscript, relativeTime } from "./sessions.ts";
import { listProjectFiles, matchFiles } from "./files.ts";

type Role = "you" | "claude" | "sys" | "err" | "file";
type Turn = { role: Role; text: string };

// Main input keybindings: Enter submits, Shift+Enter inserts a newline (default is the
// reverse). We start from the defaults so all editing keys keep working.
const INPUT_KEYBINDINGS = [
  ...defaultTextareaKeyBindings.filter(
    (b) => !((b.name === "return" || b.name === "kpenter" || b.name === "linefeed") && b.action === "newline"),
  ),
  { name: "return", action: "submit" },
  { name: "kpenter", action: "submit" },
  { name: "return", shift: true, action: "newline" },
] as typeof defaultTextareaKeyBindings;
type Opt = { name: string; description: string; value: string };
type Picker = { kind: "resume" | "model" | "theme"; title: string; options: Opt[] };
type Ask = { requestId: string; questions: AskQuestion[] };

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Trailing @-mention token being typed, e.g. "look at @src/ap" → captures "src/ap".
const MENTION_RE = /(?:^|\s)@([^\s]*)$/;

// Curated model list — the CLI does NOT broadcast its menu over stream-json (no
// `available_models` event fires), so we mirror Claude Code's picker by hand. Values
// are what get passed to set_model / --model; a bad value surfaces as an ERR line.
const MODELS: Opt[] = [
  { name: "Default", description: "let claude choose (recommended)", value: "default" },
  { name: "Opus 4.8", description: "claude-opus-4-8 — most capable", value: "claude-opus-4-8" },
  { name: "Opus 4.8 (1M)", description: "claude-opus-4-8[1m] — 1M context", value: "claude-opus-4-8[1m]" },
  { name: "Sonnet 4.6", description: "claude-sonnet-4-6 — balanced", value: "claude-sonnet-4-6" },
  { name: "Sonnet 4.6 (1M)", description: "claude-sonnet-4-6[1m] — 1M context", value: "claude-sonnet-4-6[1m]" },
  { name: "Haiku 4.5", description: "claude-haiku-4-5 — fastest", value: "claude-haiku-4-5" },
  { name: "Fable 5", description: "claude-fable-5", value: "claude-fable-5" },
];

const LABEL_TEXT: Record<Role, string> = { you: "YOU", claude: "CLAUDE", sys: "SYS", err: "ERR", file: "EDIT" };
const labelFg = (t: Theme, role: Role) =>
  role === "you" ? t.user : role === "claude" ? t.accent : role === "sys" ? t.sys : role === "file" ? t.ok : t.warn;
const bodyFg = (t: Theme, role: Role) =>
  role === "claude" ? t.ink : role === "err" ? t.warn : role === "file" ? t.ok : t.muted;

const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

// compact token count: 950 -> "950", 12300 -> "12.3k", 2_000_000 -> "2.0M"
function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(n >= 100_000 ? 0 : 1) + "k";
  return String(n);
}

// The dir we're running claude in (fixed for the process). ~-relative, trailing-trimmed.
const CWD = (() => {
  const home = homedir();
  let p = process.cwd();
  if (p === home) return "~";
  if (p.startsWith(home + "/")) p = "~" + p.slice(home.length);
  if (p.length > 30) p = "…/" + p.split("/").slice(-2).join("/");
  return p;
})();

export function App() {
  const renderer = useRenderer();
  const [themeName, setThemeName] = useState<string>(() => loadConfig().theme ?? "amber");
  const t: Theme = getTheme(themeName);
  const sessionRef = useRef<ClaudeSession | null>(null);
  const accRef = useRef(""); // streaming answer buffer, flushed on a timer
  const thinkRef = useRef(""); // streaming thinking buffer
  const usageRef = useRef<Usage>(ZERO); // live turn usage
  const dirtyRef = useRef(false);
  const thinkDirtyRef = useRef(false);
  const usageDirtyRef = useRef(false);
  const modelRef = useRef<string | undefined>(undefined); // last chosen model, kept across /new

  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState("");
  const [thinking, setThinking] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState("");
  const [inputKey, setInputKey] = useState(0); // bump to remount (clear/recall) the input
  const [inputInit, setInputInit] = useState(""); // value to mount the input with
  const historyRef = useRef<string[]>([]); // submitted inputs, oldest→newest
  const histIdxRef = useRef<number | null>(null); // cursor while browsing history (null = live)
  const filesRef = useRef<string[] | null>(null); // project file list, built lazily on first "@"
  const [fileHints, setFileHints] = useState<string[]>([]); // @-mention suggestions
  const [fileSel, setFileSel] = useState(0); // highlighted @-mention (↑↓ navigates, Tab/Enter completes)
  const draftRef = useRef(""); // latest draft, for key handlers
  const taRef = useRef<any>(null); // the input textarea renderable (read .plainText)
  const [picker, setPicker] = useState<Picker | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null); // active AskUserQuestion prompt
  const [askIdx, setAskIdx] = useState(0); // which question we're on (multi-question)
  const [otherMode, setOtherMode] = useState(false); // typing a custom "Other" answer
  const askAnsRef = useRef<{ header: string; label: string }[]>([]);
  const [live, setLive] = useState<Usage>(ZERO); // current-turn token counts
  const [sessionTok, setSessionTok] = useState({ input: 0, output: 0 });
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState({ model: "—", cost: 0, session: "—" });

  // Stable event handler — reads/writes only refs + stable setState fns.
  const onEvent = useCallback((e: SessionEvent) => {
    switch (e.type) {
      case "init":
        setStatus((p) => ({ ...p, model: e.model, session: e.sessionId.slice(0, 8) }));
        break;
      case "delta":
        accRef.current += e.text;
        dirtyRef.current = true;
        break;
      case "thinking":
        thinkRef.current += e.text;
        thinkDirtyRef.current = true;
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
        setLive(ZERO);
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
    dirtyRef.current = thinkDirtyRef.current = usageDirtyRef.current = false;
    setStreaming("");
    setThinking("");
    setLive(ZERO);
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
    }, 60);
    return () => clearInterval(id);
  }, [busy]);

  const quit = useCallback(() => {
    sessionRef.current?.kill();
    renderer?.stop();
    process.exit(0);
  }, [renderer]);

  // Track the draft and recompute @-mention suggestions on every keystroke.
  const onDraft = (value: string) => {
    setDraft(value);
    draftRef.current = value;
    const m = value.match(MENTION_RE);
    if (m) {
      if (!filesRef.current) filesRef.current = listProjectFiles(process.cwd());
      setFileHints(matchFiles(filesRef.current, m[1] ?? ""));
      setFileSel(0); // reset highlight to the top match on every keystroke
    } else {
      setFileHints([]);
    }
  };

  // Tab/Enter completes the trailing @token to the highlighted file suggestion.
  const acceptMention = () => {
    const path = fileHints[fileSel] ?? fileHints[0];
    if (!path) return;
    const d = draftRef.current;
    const m = d.match(MENTION_RE);
    if (!m) return;
    const token = "@" + (m[1] ?? "");
    const next = d.slice(0, d.length - token.length) + "@" + path + " ";
    setDraft(next);
    draftRef.current = next;
    setInputInit(next);
    setInputKey((k) => k + 1);
    setFileHints([]);
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
    dirtyRef.current = thinkDirtyRef.current = false;
    setStreaming("");
    setThinking("");
    setBusy(false);
    pushSys("interrupted — turn stopped.");
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") quit();
    else if (fileHints.length && key.name === "tab") acceptMention();
    else if (fileHints.length && (key.name === "up" || key.name === "down")) {
      // Navigate the @-mention picker; wraps top↔bottom for quick reach.
      const n = fileHints.length;
      setFileSel((s) => (key.name === "up" ? (s - 1 + n) % n : (s + 1) % n));
    }
    else if (fileHints.length && key.name === "escape") setFileHints([]);
    else if (key.name === "escape") {
      if (ask && otherMode) setOtherMode(false); // back to the options
      else if (ask) { sessionRef.current?.answerQuestion(ask.requestId, "The user dismissed the question without selecting."); setAsk(null); }
      else if (picker) setPicker(null);
      else if (busy) interrupt(); // stop the in-progress turn
    } else if (!picker && !ask && !draftRef.current.includes("\n") && (key.name === "up" || key.name === "down")) {
      // Shell-style history recall on the main input — only when it's a single line
      // (multi-line drafts let the textarea move the cursor between lines instead).
      const hist = historyRef.current;
      if (!hist.length) return;
      let idx = histIdxRef.current;
      if (key.name === "up") {
        idx = idx === null ? hist.length - 1 : Math.max(0, idx - 1);
      } else {
        if (idx === null) return; // already live
        idx += 1;
        if (idx >= hist.length) { // past the newest → back to an empty line
          histIdxRef.current = null;
          setInputInit(""); setDraft(""); draftRef.current = ""; setInputKey((k) => k + 1);
          return;
        }
      }
      histIdxRef.current = idx;
      const v = hist[idx] ?? "";
      setInputInit(v); setDraft(v); draftRef.current = v; setInputKey((k) => k + 1);
    }
  });

  const pushSys = (text: string) => setTurns((p) => [...p, { role: "sys", text }]);

  const openPicker = (kind: "resume" | "model" | "theme") => {
    if (kind === "theme") {
      const options: Opt[] = THEME_NAMES.map((n) => ({ name: n, description: THEMES[n]!.label, value: n }));
      setPicker({ kind, title: "Switch theme — ↑↓ to preview name · Enter to apply · Esc to cancel", options });
      return;
    }
    if (kind === "model") {
      const options: Opt[] = models.length
        ? models.map((m) => ({ name: shortModel(m), description: m, value: m }))
        : MODELS;
      setPicker({ kind, title: "Switch model — ↑↓ to choose · Enter to select · Esc to cancel", options });
      return;
    }
    const now = Date.now();
    const options: Opt[] = listSessions(process.cwd()).map((s) => ({
      name: (s.summary || "(no preview)").slice(0, 64),
      description: `${s.id.slice(0, 8)} · ${relativeTime(s.mtimeMs, now)}`,
      value: s.id,
    }));
    if (!options.length) { pushSys("no past sessions found for this directory."); return; }
    setPicker({ kind, title: "Resume a session — ↑↓ to choose · Enter to select · Esc to cancel", options });
  };

  const ctx: CommandCtx = {
    print: pushSys,
    clear: () => setTurns([]),
    newSession: () => { setTurns([]); setSessionTok({ input: 0, output: 0 }); pushSys("started a fresh session."); startSession(); },
    resume: (id) => {
      const cwd = process.cwd();
      // Resolve "continue latest" to a concrete id so we can load its transcript.
      const target = id ?? listSessions(cwd, 1)[0]?.id;
      if (!target) { setTurns([]); pushSys("no past session to continue in this directory."); startSession(); return; }
      setTurns(loadTranscript(target, cwd)); // replay history so it's not a blank screen
      pushSys(`resumed session ${target.slice(0, 8)} — history restored`);
      startSession({ resume: target });
    },
    setModel: (alias) => {
      modelRef.current = alias;
      sessionRef.current?.setModel(alias); // runtime switch, keeps context
      setStatus((p) => ({ ...p, model: alias }));
      pushSys(`switching model → ${alias}…`);
    },
    setTheme: (name) => {
      if (!THEMES[name]) { pushSys(`unknown theme: ${name}  ·  try ${THEME_NAMES.join(", ")}`); return; }
      setThemeName(name);
      saveConfig({ theme: name });
      pushSys(`theme → ${name}`);
    },
    openPicker,
    quit,
    model: () => shortModel(status.model),
    session: () => status.session,
  };

  const onPick = (opt: Opt | null) => {
    const kind = picker?.kind;
    setPicker(null);
    if (!opt || !kind) return;
    if (kind === "resume") ctx.resume(opt.value);
    else if (kind === "model") ctx.setModel(opt.value);
    else ctx.setTheme(opt.value);
  };

  const OTHER = "__other__";

  // Record one answer, then advance to the next question or finalize + send.
  const recordAnswer = (label: string) => {
    if (!ask) return;
    const q = ask.questions[askIdx]!;
    askAnsRef.current.push({ header: q.header || q.question, label });
    setOtherMode(false);
    if (askIdx + 1 < ask.questions.length) {
      setAskIdx((i) => i + 1);
      return;
    }
    const msg = "The user selected — " + askAnsRef.current.map((a) => `${a.header}: ${a.label}`).join("; ");
    sessionRef.current?.answerQuestion(ask.requestId, msg);
    pushSys("answered: " + askAnsRef.current.map((a) => `${a.header}=${a.label}`).join(", "));
    setAsk(null);
    setAskIdx(0);
  };

  // Select an option; "Other" switches to free-text entry (AskUserQuestion always
  // offers a typeable custom answer — the client adds it, Claude never lists it).
  const onAnswer = (opt: Opt | null) => {
    if (!opt) return;
    if (opt.value === OTHER) { setOtherMode(true); return; }
    recordAnswer(opt.value);
  };

  const submitOther = (value: string) => {
    const text = value.trim();
    if (!text) { setOtherMode(false); return; } // empty → back to the options
    recordAnswer(text);
  };

  const submit = (value: string) => {
    // Enter with the @-mention picker open completes the highlighted file instead
    // of sending — matches the Tab behavior and keeps a single submit path.
    if (fileHints.length && MENTION_RE.test(draftRef.current)) { acceptMention(); return; }
    const text = value.trim();
    setDraft("");
    draftRef.current = "";
    setFileHints([]);
    setInputInit("");
    setInputKey((k) => k + 1); // remount input → clears it
    histIdxRef.current = null; // back to a live line
    if (!text) return;
    const h = historyRef.current;
    if (h[h.length - 1] !== text) h.push(text); // record for ↑/↓ recall (skip dupes)
    if (dispatchCommand(text, ctx)) return; // slash command — never forwarded
    if (busy) { pushSys("still working — wait for the current turn to finish."); return; }
    setTurns((p) => [...p, { role: "you", text }]);
    accRef.current = "";
    thinkRef.current = "";
    usageRef.current = ZERO;
    setStreaming("");
    setThinking("");
    setLive(ZERO);
    setBusy(true);
    sessionRef.current?.send(text);
  };

  const spin = SPINNER[tick % SPINNER.length];
  const model = shortModel(status.model);
  const hud = `↑${fmtTok(live.input)} ↓${fmtTok(live.output)}`;
  const hints = draft.startsWith("/")
    ? COMMANDS.filter((c) => ("/" + c.name).startsWith(draft.split(/\s+/)[0] ?? "")).slice(0, 5)
    : [];
  const askQ = ask?.questions[askIdx];
  const overlay = ask && askQ && !otherMode
    ? {
        title:
          (askQ.header ? askQ.header + " · " : "") + askQ.question +
          (ask.questions.length > 1 ? `  (${askIdx + 1}/${ask.questions.length})` : "") + "  · Esc to dismiss",
        // Always append a typeable "Other" — AskUserQuestion guarantees the user can
        // provide a custom answer; Claude never lists it, the client must.
        options: [
          ...askQ.options.map((o) => ({ name: o.label, description: o.description ?? "", value: o.label })),
          { name: "Other…", description: "type your own answer", value: OTHER },
        ],
        onSelect: onAnswer,
      }
    : picker
      ? { title: picker.title, options: picker.options, onSelect: onPick }
      : null;

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={t.bg}>
      {/* header — single composed line so segments can't overlap */}
      <box backgroundColor={t.panel} paddingLeft={2} border={["bottom"]} borderColor={t.accentDim} flexShrink={0}>
        <text>
          <span fg={t.accent}>▓▒░ SUMMON</span>
          <span fg={t.muted}>{"  ·  subscription-native claude"}</span>
        </text>
      </box>

      {/* conversation — or an overlay (free-text answer / select / picker) */}
      {ask && askQ && otherMode ? (
        <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingTop={1} backgroundColor={t.bg}>
          <text content={`${askQ.header ? askQ.header + " · " : ""}${askQ.question}  · type your answer · Enter to submit · Esc to go back`} fg={t.accent} />
          <box marginTop={1} flexDirection="row">
            <text content=" › " fg={t.accent} />
            <input
              focused
              flexGrow={1}
              onSubmit={(v: any) => submitOther(v)}
              placeholder="your answer"
              placeholderColor={t.muted}
              backgroundColor={t.bg}
              focusedBackgroundColor={t.bg}
              textColor={t.ink}
              focusedTextColor={t.ink}
            />
          </box>
        </box>
      ) : overlay ? (
        <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingTop={1} backgroundColor={t.bg}>
          <text content={overlay.title} fg={t.accent} />
          <select
            focused
            flexGrow={1}
            marginTop={1}
            options={overlay.options}
            showDescription
            wrapSelection
            onSelect={(_i: number, opt: any) => overlay.onSelect(opt)}
            backgroundColor={t.bg}
            textColor={t.ink}
            focusedBackgroundColor={t.bg}
            focusedTextColor={t.ink}
            selectedBackgroundColor={t.panel}
            selectedTextColor={t.accent}
            descriptionColor={t.muted}
            selectedDescriptionColor={t.muted}
          />
        </box>
      ) : (
        <scrollbox flexGrow={1} flexShrink={1} minHeight={0} paddingLeft={2} paddingTop={1} backgroundColor={t.bg} stickyScroll stickyStart="bottom">
          {turns.length === 0 && !streaming && !thinking ? (
            <text content="Ask anything. Enter to send · /help for commands · Ctrl+C to quit." fg={t.muted} />
          ) : null}
          {turns.map((turn, i) => (
            <box key={i} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
              <text content={LABEL_TEXT[turn.role]} fg={labelFg(t, turn.role)} />
              <text content={turn.text} fg={bodyFg(t, turn.role)} />
            </box>
          ))}
          {thinking ? (
            <box flexDirection="column" marginTop={turns.length ? 1 : 0}>
              <text content="THINKING" fg={t.sys} />
              <text content={thinking} fg={t.muted} />
            </box>
          ) : null}
          {streaming ? (
            <box flexDirection="column" marginTop={turns.length || thinking ? 1 : 0}>
              <text content="CLAUDE" fg={t.accent} />
              <text content={streaming + "▌"} fg={t.ink} />
            </box>
          ) : busy && !thinking ? (
            <box marginTop={turns.length ? 1 : 0}>
              <text content={`${spin} thinking…  · Esc to interrupt`} fg={t.accentDim} />
            </box>
          ) : null}
          {busy ? <text content={`  ${hud}`} fg={t.accentDim} /> : null}
        </scrollbox>
      )}

      {/* @-mention file suggestions — Tab completes the first (▸-marked) one */}
      {fileHints.length && !overlay && !ask ? (
        <box backgroundColor={t.bg} paddingLeft={3} flexDirection="column">
          {fileHints.map((f, i) => (
            <text key={f} content={(i === fileSel ? "▸ " : "  ") + "@" + f} fg={i === fileSel ? t.accent : t.muted} />
          ))}
          <text content="  ↑↓ to choose · Tab/Enter to complete · Esc to dismiss" fg={t.accentDim} />
        </box>
      ) : hints.length && !overlay ? (
        /* command hints */
        <box backgroundColor={t.bg} paddingLeft={3}>
          <text>
            {hints.map((c, i) => (
              <span key={c.name} fg={t.accentDim}>{(i ? "   " : "") + "/" + c.name}</span>
            ))}
          </text>
        </box>
      ) : null}

      {/* input — a textarea so long text / pastes wrap to multiple lines (grows up to
          6 rows, then scrolls). Enter submits, Shift+Enter inserts a newline. */}
      <box backgroundColor={t.panel} paddingLeft={1} paddingRight={1} border={["top"]} borderColor={t.accentDim} flexShrink={0} flexDirection="row">
        <text content={busy ? ` ${spin} ` : " › "} fg={t.accent} />
        <textarea
          key={inputKey}
          ref={taRef}
          initialValue={inputInit}
          focused={!overlay && !ask}
          flexGrow={1}
          minHeight={1}
          maxHeight={6}
          wrapMode="word"
          keyBindings={INPUT_KEYBINDINGS}
          onContentChange={() => onDraft(taRef.current?.plainText ?? "")}
          onSubmit={() => submit(taRef.current?.plainText ?? "")}
          placeholder={busy ? "waiting for claude…  (commands still work)" : "type a message, or /help"}
          placeholderColor={t.muted}
          backgroundColor={t.panel}
          focusedBackgroundColor={t.panel}
          textColor={t.ink}
          focusedTextColor={t.ink}
        />
      </box>

      {/* status bar — single composed line */}
      <box backgroundColor={t.panel} paddingLeft={2} border={["top"]} borderColor={t.accentDim} flexShrink={0}>
        <text>
          <span fg={t.muted}>{CWD + "  ·  "}</span>
          <span fg={t.accent}>{model}</span>
          <span fg={t.muted}>{`  ·  ↑${fmtTok(sessionTok.input)} ↓${fmtTok(sessionTok.output)}  ·  ~$${status.cost.toFixed(4)}`}</span>
        </text>
      </box>
    </box>
  );
}
