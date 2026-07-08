import { useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, usePaste, useRenderer } from "@opentui/react";
import { decodePasteBytes } from "@opentui/core";
import { THEMES, THEME_NAMES, getTheme, shortModel, type Theme } from "./theme.ts";
import { loadConfig, saveConfig } from "../config.ts";
import { COMMANDS, dispatchCommand, activeSlashToken, type CommandCtx } from "../domain/commands.ts";
import { loadSkills, skillsAsCommands } from "../domain/skills.ts";
import { fmtTok, totalTok } from "../lib/format.ts";
import { MENTION_RE } from "./constants.ts";
import { useConversation } from "./hooks/useConversation.ts";
import { useComposer } from "./hooks/useComposer.ts";
import { useAskFlow } from "./hooks/useAskFlow.ts";
import { usePickers } from "./hooks/usePickers.ts";
import { useUsage } from "./hooks/useUsage.ts";
import { Header } from "./components/Header.tsx";
import { Conversation } from "./components/Conversation.tsx";
import { OtherInput } from "./components/OtherInput.tsx";
import { OverlaySelect } from "./components/OverlaySelect.tsx";
import { HintsPanel } from "./components/HintsPanel.tsx";
import { UsagePanel } from "./components/UsagePanel.tsx";
import { QueuePanel } from "./components/QueuePanel.tsx";
import { InputBar } from "./components/InputBar.tsx";
import { AttachmentsPanel } from "./components/AttachmentsPanel.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { readClipboardImage, writeClipboard } from "../domain/clipboard.ts";
import { toImageBlock } from "../domain/content.ts";

export function App() {
  const renderer = useRenderer();
  const [themeName, setThemeName] = useState<string>(() => loadConfig().theme ?? "amber");
  const t: Theme = getTheme(themeName);

  // The conversation engine — session, streaming state, queue, titles (see hook).
  const conv = useConversation();

  // Skills discovered from .claude/.ai (project + global), read once at startup, unified
  // with the built-in commands so hints and dispatch see both.
  const [skills] = useState(() => loadSkills());
  const allCommands = useMemo(() => [...COMMANDS, ...skillsAsCommands(skills)], [skills]);

  const composer = useComposer(allCommands);
  const usage = useUsage();
  const usageOpen = usage.usage !== null;

  const setTheme = (name: string) => {
    if (!THEMES[name]) { conv.pushSys(`unknown theme: ${name}  ·  try ${THEME_NAMES.join(", ")}`); return; }
    setThemeName(name);
    saveConfig({ theme: name });
    conv.pushSys(`theme → ${name}`);
  };

  const pickers = usePickers({
    models: conv.models,
    pushSys: conv.pushSys,
    resume: conv.resume,
    setModel: conv.setModelRuntime,
    setTheme,
  });

  const quit = () => {
    conv.killSession();
    renderer?.stop();
    process.exit(0);
  };

  const ctx: CommandCtx = {
    print: conv.pushSys,
    // Skills forward a synthesized prompt. Route through the same queue as typed input
    // so it respects an in-flight turn; `display` keeps the transcript short.
    sendPrompt: conv.enqueueOrSend,
    clear: conv.clear,
    newSession: conv.newSession,
    resume: conv.resume,
    setModel: conv.setModelRuntime,
    setTheme,
    openPicker: pickers.openPicker,
    quit,
    model: () => shortModel(conv.status.model),
    session: () => conv.status.session,
    usage: () => ({ ...conv.sessionTok, costUsd: conv.status.cost }),
    showUsage: usage.showUsage,
  };

  const askFlow = useAskFlow({
    ask: conv.ask,
    setAsk: conv.setAsk,
    askIdx: conv.askIdx,
    setAskIdx: conv.setAskIdx,
    setOtherMode: conv.setOtherMode,
    askAnsRef: conv.askAnsRef,
    answerQuestion: conv.answerQuestion,
    pushSys: conv.pushSys,
  });

  // Pull an image off the OS clipboard and attach it (no-op if there isn't one). Shared
  // by the Ctrl+V binding and the empty-paste path — real terminals don't deliver image
  // bytes on Cmd+V, so we read the clipboard directly like Claude Code does.
  const attachClipboardImage = () => {
    if (overlay || conv.ask || usageOpen) return;
    void readClipboardImage().then((img) => { if (img) composer.addAttachment(img); });
  };

  // Bracketed paste. Empty/whitespace text usually means an image sits on the clipboard
  // (Cmd+V), so try to attach it; real text pastes fall through to the textarea untouched.
  usePaste((e) => {
    if (!decodePasteBytes(e.bytes).trim()) attachClipboardImage();
  });

  // Copy-on-select: the moment a drag-selection finishes, put its text on the clipboard.
  // This is the only copy path that works everywhere — macOS hands Cmd+C to the terminal
  // (never to us), and the terminal has no native selection to copy since useMouse grabs the
  // pointer for scroll. So there's no key to press: drag to highlight and it's copied. We
  // write the OS clipboard directly (pbcopy/clip/wl-copy) and also fire OSC52 so it still
  // works over SSH where the native tool isn't the remote's clipboard. The highlight is left
  // in place as confirmation; it clears on the next click/drag.
  const copyText = (text: string) => {
    const osc = renderer?.copyToClipboardOSC52(text) ?? false;
    void writeClipboard(text).then((native) => {
      conv.pushSys(native || osc ? "copied selection to clipboard" : "copy failed — no clipboard tool found (install xclip/wl-clipboard)");
    });
  };
  // The renderer's "selection" event fires once per finished drag; keep a ref so the
  // subscribe-once listener always calls the latest closure (conv/renderer change per render).
  const copyRef = useRef(copyText);
  copyRef.current = copyText;
  useEffect(() => {
    if (!renderer) return;
    const onSelection = (sel: { getSelectedText?: () => string } | null) => {
      const text = sel?.getSelectedText?.() ?? "";
      if (text.trim()) copyRef.current(text);
    };
    renderer.on("selection", onSelection);
    return () => { renderer.off("selection", onSelection); };
  }, [renderer]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") quit();
    else if (key.ctrl && key.name === "v") attachClipboardImage();
    else if (usageOpen && (key.name === "escape" || key.name === "return" || key.name === "q")) usage.closeUsage();
    else if (composer.fileHints.length && key.name === "tab") composer.acceptMention();
    else if (composer.fileHints.length && (key.name === "up" || key.name === "down")) composer.navigateFiles(key.name);
    else if (composer.fileHints.length && key.name === "escape") composer.dismissFiles();
    else if (composer.hints.length && key.name === "tab") composer.acceptCommand(composer.hints);
    else if (composer.hints.length && (key.name === "up" || key.name === "down")) composer.navigateHints(key.name);
    else if (composer.hints.length && key.name === "escape") composer.dismissHints();
    else if (key.name === "escape") {
      if (conv.ask && conv.otherMode) conv.setOtherMode(false); // back to the options
      else if (conv.ask) askFlow.dismissAsk();
      else if (pickers.picker) pickers.closePicker();
      else if (conv.busy) conv.interrupt(); // stop the in-progress turn
    } else if (!pickers.picker && !conv.ask && !composer.draftRef.current.includes("\n") && (key.name === "up" || key.name === "down")) {
      // Shell-style history recall on the main input — only when it's a single line
      // (multi-line drafts let the textarea move the cursor between lines instead).
      composer.recall(key.name);
    }
  });

  const submit = (value: string) => {
    // Enter with the @-mention picker open completes the highlighted file instead
    // of sending — matches the Tab behavior and keeps a single submit path.
    if (composer.fileHints.length && MENTION_RE.test(composer.draftRef.current)) { composer.acceptMention(); return; }
    // Enter with the /command menu open completes the highlighted entry into the
    // input (not send) — unless the typed token already IS that command, in which
    // case fall through and run it. Second Enter after completion always runs.
    if (composer.hints.length) {
      const cmd = composer.hints[composer.cmdSel] ?? composer.hints[0];
      // Complete first unless the active /token already IS the selected command (fully
      // typed) — then fall through and run it. Works for start- and mid-message tokens.
      if (cmd && cmd.name !== activeSlashToken(composer.draftRef.current)) { composer.acceptCommand(composer.hints); return; }
    }
    const text = value.trim();
    const images = composer.attachments.map(toImageBlock); // capture before clear wipes them
    composer.clearForSubmit();
    if (!text && !images.length) return;
    if (text) composer.recordHistory(text);
    if (text && dispatchCommand(text, ctx, allCommands)) return; // slash command or skill — not forwarded verbatim
    // Busy: queue it; the drain effect sends the next message when the turn frees up.
    conv.enqueueOrSend(text, text, images.length ? images : undefined);
  };

  const model = shortModel(conv.status.model);
  const hud = `↑${fmtTok(conv.live.input)} ↓${fmtTok(conv.live.output)}`;
  const askQ = askFlow.askQ;
  const askOverlay = askFlow.askOverlay({ otherMode: conv.otherMode });
  const overlay = askOverlay ?? pickers.pickerOverlay;

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={t.bg}
      // Click anywhere to focus the input — the terminal-standard behavior. The renderer
      // otherwise autofocuses whatever focusable element sits under the cursor (e.g. the
      // scrollbox), so we preventDefault to suppress that walk and focus the input instead.
      // Skip while an overlay/answer picker owns focus so we don't yank it away.
      onMouseDown={(e) => {
        if (overlay || conv.ask || usageOpen) return;
        e.preventDefault();
        composer.taRef.current?.focus();
      }}
    >
      <Header t={t} />

      {/* conversation — or an overlay (free-text answer / select / picker) */}
      {conv.ask && askQ && conv.otherMode ? (
        <OtherInput t={t} askQ={askQ} onSubmit={askFlow.submitOther} />
      ) : overlay ? (
        <OverlaySelect key={overlay.title} t={t} title={overlay.title} options={overlay.options} onSelect={overlay.onSelect} />
      ) : usageOpen ? (
        <UsagePanel t={t} usage={usage.usage!} now={Date.now()} />
      ) : (
        <Conversation
          t={t}
          turns={conv.turns}
          streaming={conv.streaming}
          thinking={conv.thinking}
          busy={conv.busy}
          spin={conv.spin}
          activity={conv.activity}
          hud={hud}
        />
      )}

      <HintsPanel
        t={t}
        fileHints={composer.fileHints}
        fileSel={composer.fileSel}
        hints={composer.hints}
        cmdSel={composer.cmdSel}
        hasOverlay={!!overlay || usageOpen}
        hasAsk={!!conv.ask}
      />

      <QueuePanel t={t} queue={conv.queue} />

      <AttachmentsPanel t={t} attachments={composer.attachments} />

      <InputBar
        t={t}
        busy={conv.busy}
        spin={conv.spin}
        focused={!overlay && !conv.ask && !usageOpen}
        inputKey={composer.inputKey}
        inputInit={composer.inputInit}
        taRef={composer.taRef}
        onDraft={composer.onDraft}
        onSubmit={submit}
      />

      <StatusBar t={t} model={model} sessionTok={totalTok(conv.sessionTok, conv.live)} cost={conv.status.cost} />
    </box>
  );
}
