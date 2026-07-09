import { useRef, useState } from "react";
import { matchCommands, completeCommand, type Command } from "../../domain/commands.ts";
import { fileListKey, listFilesForQuery, matchFiles } from "../../domain/files.ts";
import { imageMarker, type ImageAttachment } from "../../domain/content.ts";
import { MENTION_RE } from "../constants.ts";

/**
 * The message composer: the input draft, its @-mention and /command autocomplete, and
 * shell-style ↑/↓ history recall. Owns the input-remount plumbing (inputKey/inputInit)
 * used to programmatically clear or refill the textarea. The keyboard handler and
 * submit path (in App) drive it via the returned methods.
 */
export function useComposer(allCommands: Command[]) {
  const [draft, setDraft] = useState("");
  const [inputKey, setInputKey] = useState(0); // bump to remount (clear/recall) the input
  const [inputInit, setInputInit] = useState(""); // value to mount the input with
  const historyRef = useRef<string[]>([]); // submitted inputs, oldest→newest
  const histIdxRef = useRef<number | null>(null); // cursor while browsing history (null = live)
  const filesRef = useRef<Map<string, string[]>>(new Map()); // dir prefix → file list, built lazily per dir
  const [fileHints, setFileHints] = useState<string[]>([]); // @-mention suggestions
  const [fileSel, setFileSel] = useState(0); // highlighted @-mention (↑↓ navigates, Tab/Enter completes)
  const [cmdSel, setCmdSel] = useState(0); // highlighted /command or skill in the hint list
  const [hintsOff, setHintsOff] = useState(false); // Esc dismisses the command hints until the next keystroke
  const draftRef = useRef(""); // latest draft, for key handlers
  const taRef = useRef<any>(null); // the input textarea renderable (read .plainText)
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]); // pasted images, sent on submit
  const attachSeq = useRef(0); // per-message image counter → "[Image #N]"

  // Track the draft and recompute @-mention suggestions on every keystroke.
  const onDraft = (value: string) => {
    setDraft(value);
    draftRef.current = value;
    setCmdSel(0); // reset the /command highlight to the top match on every keystroke
    setHintsOff(false); // typing un-dismisses the command hints
    const m = value.match(MENTION_RE);
    if (m) {
      const query = m[1] ?? "";
      const key = fileListKey(query); // keys on walk dir + hidden-ness ("../" reroots; ".ai" adds hidden)
      let list = filesRef.current.get(key);
      if (!list) {
        list = listFilesForQuery(process.cwd(), query);
        filesRef.current.set(key, list);
      }
      setFileHints(matchFiles(list, query));
      setFileSel(0); // reset highlight to the top match on every keystroke
    } else {
      setFileHints([]);
    }
  };

  // A pasted image: assign the next "[Image #N]" id, remember it for submit, and splice
  // the marker into the draft so the user sees it inline (same remount trick as mentions).
  const addAttachment = (att: Omit<ImageAttachment, "id">) => {
    const id = (attachSeq.current += 1);
    setAttachments((a) => [...a, { ...att, id }]);
    const cur = draftRef.current;
    const next = (cur && !cur.endsWith(" ") ? cur + " " : cur) + imageMarker(id) + " ";
    setDraft(next);
    draftRef.current = next;
    setInputInit(next);
    setInputKey((k) => k + 1);
  };

  const clearAttachments = () => { setAttachments([]); attachSeq.current = 0; };

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

  // Tab/Enter completes the /token to the highlighted command or skill and drops it
  // into the input (with a trailing space) — it does NOT send. The next Enter runs it.
  const acceptCommand = (cmds: Command[]) => {
    const cmd = cmds[cmdSel] ?? cmds[0];
    if (!cmd) return;
    const next = completeCommand(draftRef.current, cmd.name);
    setDraft(next);
    draftRef.current = next;
    setInputInit(next);
    setInputKey((k) => k + 1);
    setCmdSel(0);
  };

  // Navigate the @-mention picker; wraps top↔bottom for quick reach.
  const navigateFiles = (dir: "up" | "down") => {
    const n = fileHints.length;
    setFileSel((s) => (dir === "up" ? (s - 1 + n) % n : (s + 1) % n));
  };

  // Navigate the /command · skill menu; wraps top↔bottom like the @-picker.
  const navigateHints = (dir: "up" | "down") => {
    const n = hints.length;
    setCmdSel((s) => (dir === "up" ? (s - 1 + n) % n : (s + 1) % n));
  };

  const dismissFiles = () => setFileHints([]);
  const dismissHints = () => setHintsOff(true);

  // Shell-style history recall on the main input. Caller gates this to single-line
  // drafts with no picker/overlay open (the textarea moves the cursor otherwise).
  const recall = (dir: "up" | "down") => {
    const hist = historyRef.current;
    if (!hist.length) return;
    let idx = histIdxRef.current;
    if (dir === "up") {
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
  };

  // Clear the input on submit (remount → empty) and drop back to a live history line.
  const clearForSubmit = () => {
    setDraft("");
    draftRef.current = "";
    setFileHints([]);
    setInputInit("");
    setInputKey((k) => k + 1); // remount input → clears it
    histIdxRef.current = null; // back to a live line
    clearAttachments(); // drop pending images — they went out with this message
  };

  // Record a submitted input for ↑/↓ recall (skipping consecutive dupes).
  const recordHistory = (text: string) => {
    const h = historyRef.current;
    if (h[h.length - 1] !== text) h.push(text);
  };

  // Command/skill suggestions for the current draft (also used by the keyboard handler
  // and submit, so it's computed here rather than only in the render body).
  const hints = hintsOff ? [] : matchCommands(allCommands, draft);

  return {
    draft, draftRef, hints, fileHints, fileSel, cmdSel, inputKey, inputInit, taRef, attachments,
    onDraft, acceptMention, acceptCommand, navigateFiles, navigateHints,
    dismissFiles, dismissHints, recall, clearForSubmit, recordHistory, addAttachment,
  };
}
