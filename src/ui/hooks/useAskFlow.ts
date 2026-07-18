import { useRef, type MutableRefObject } from "react";
import { type Ask, type Opt } from "../constants.ts";
import {
  OTHER,
  askOptions,
  splitOther,
  isLastQuestion,
  formatAnswers,
  echoAnswers,
  type AskAnswer,
} from "../../domain/ask.ts";

type AskAnswers = MutableRefObject<AskAnswer[]>;

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
 * multi-question prompts, single- and multi-select, the free-text "Other…" path, and
 * dismissal. The underlying state lives in useConversation (so the stable event reducer
 * can set it); this hook composes the handlers and the overlay descriptor the UI renders.
 * Pure logic (option building, answer formatting, toggling) lives in domain/ask.ts.
 */
export function useAskFlow(d: Deps) {
  const { ask, setAsk, askIdx, setAskIdx, setOtherMode, askAnsRef, answerQuestion, pushSys } = d;
  // Multi-select labels already checked when the user opens "Other…" — held until the
  // free-text is submitted, then combined with it into the one recorded answer.
  const pendingRef = useRef<string[]>([]);

  // Record one question's answer (one or more labels), then advance to the next
  // question or finalize + send the full message.
  const recordAnswer = (labels: string[]) => {
    if (!ask) return;
    const q = ask.questions[askIdx]!;
    askAnsRef.current.push({ header: q.header || q.question, labels });
    setOtherMode(false);
    pendingRef.current = [];
    if (!isLastQuestion(ask.questions.length, askIdx)) {
      setAskIdx((i) => i + 1);
      return;
    }
    answerQuestion(ask.requestId, formatAnswers(askAnsRef.current));
    pushSys(echoAnswers(askAnsRef.current));
    setAsk(null);
    setAskIdx(() => 0);
  };

  // Single-select: pick one option; "Other" switches to free-text entry.
  const onAnswer = (opt: Opt | null) => {
    if (!opt) return;
    if (opt.value === OTHER) { setOtherMode(true); return; }
    recordAnswer([opt.value]);
  };

  // Multi-select: confirm the checked options. If "Other…" was among them, collect its
  // free-text first (holding the other checked labels), otherwise record them straight.
  const onConfirmMulti = (opts: Opt[]) => {
    if (!opts.length) return; // nothing checked — ignore, Esc dismisses
    const { labels, other } = splitOther(opts);
    if (other) { pendingRef.current = labels; setOtherMode(true); return; }
    recordAnswer(labels);
  };

  const submitOther = (value: string) => {
    const text = value.trim();
    const pending = pendingRef.current;
    // Empty free-text: in multi-select with other boxes checked, submit just those;
    // otherwise go back to the options.
    if (!text) {
      if (pending.length) { recordAnswer(pending); return; }
      setOtherMode(false);
      return;
    }
    recordAnswer([...pending, text]);
  };

  // Esc with no free-text open: tell Claude the prompt was dismissed and clear it.
  const dismissAsk = () => {
    if (!ask) return;
    answerQuestion(ask.requestId, "The user dismissed the question without selecting.");
    setAsk(null);
  };

  const askQ = ask?.questions[askIdx];
  const multi = !!askQ?.multiSelect;

  // Overlay descriptor for the select prompt (null when not asking / in free-text mode).
  const askOverlay = (opt: { otherMode: boolean }) =>
    ask && askQ && !opt.otherMode
      ? {
          title:
            (askQ.header ? askQ.header + " · " : "") + askQ.question +
            (ask.questions.length > 1 ? `  (${askIdx + 1}/${ask.questions.length})` : "") +
            (multi ? "  · Space to toggle · Enter to confirm · Esc to dismiss" : "  · Enter to select · Esc to dismiss"),
          options: askOptions(askQ) as Opt[],
          multiSelect: multi,
          onSelect: onAnswer,
          onConfirm: onConfirmMulti,
        }
      : null;

  return { askQ, recordAnswer, onAnswer, onConfirmMulti, submitOther, dismissAsk, askOverlay };
}
