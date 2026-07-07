import type { MutableRefObject } from "react";
import { OTHER, type Ask, type Opt } from "../constants.ts";

type AskAnswers = MutableRefObject<{ header: string; label: string }[]>;

type Deps = {
  ask: Ask | null;
  setAsk: (a: Ask | null) => void;
  askIdx: number;
  setAskIdx: (fn: (i: number) => number) => void;
  setOtherMode: (v: boolean) => void;
  askAnsRef: AskAnswers;
  answerQuestion: (requestId: string, message: string) => void;
  pushSys: (text: string) => void;
};

/**
 * The AskUserQuestion interaction: recording each answer, advancing through
 * multi-question prompts, the free-text "Other…" path, and dismissal. The underlying
 * state lives in useConversation (so the stable event reducer can set it); this hook
 * composes the handlers and the overlay descriptor the UI renders.
 */
export function useAskFlow(d: Deps) {
  const { ask, setAsk, askIdx, setAskIdx, setOtherMode, askAnsRef, answerQuestion, pushSys } = d;

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
    answerQuestion(ask.requestId, msg);
    pushSys("answered: " + askAnsRef.current.map((a) => `${a.header}=${a.label}`).join(", "));
    setAsk(null);
    setAskIdx(() => 0);
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

  // Esc with no free-text open: tell Claude the prompt was dismissed and clear it.
  const dismissAsk = () => {
    if (!ask) return;
    answerQuestion(ask.requestId, "The user dismissed the question without selecting.");
    setAsk(null);
  };

  const askQ = ask?.questions[askIdx];

  // Overlay descriptor for the select prompt (null when not asking / in free-text mode).
  const askOverlay = (opt: { otherMode: boolean }) =>
    ask && askQ && !opt.otherMode
      ? {
          title:
            (askQ.header ? askQ.header + " · " : "") + askQ.question +
            (ask.questions.length > 1 ? `  (${askIdx + 1}/${ask.questions.length})` : "") + "  · Esc to dismiss",
          // Always append a typeable "Other" — AskUserQuestion guarantees the user can
          // provide a custom answer; Claude never lists it, the client must.
          options: [
            ...askQ.options.map((o) => ({ name: o.label, description: o.description ?? "", value: o.label })),
            { name: "Other…", description: "type your own answer", value: OTHER },
          ] as Opt[],
          onSelect: onAnswer,
        }
      : null;

  return { askQ, recordAnswer, onAnswer, submitOther, dismissAsk, askOverlay };
}
