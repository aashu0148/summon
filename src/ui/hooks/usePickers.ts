import { useState } from "react";
import { THEMES, THEME_NAMES, shortModel } from "../theme.ts";
import { listSessions, relativeTime, sessionLabel } from "../../domain/sessions.ts";
import { MODELS, type Opt, type Picker } from "../constants.ts";

type Deps = {
  models: string[];
  pushSys: (text: string) => void;
  resume: (id?: string) => void;
  setModel: (alias: string) => void;
  setTheme: (name: string) => void;
};

/**
 * The interactive overlays for /resume, /model, and /theme — building each picker's
 * option list and applying the selection to the matching action.
 */
export function usePickers(d: Deps) {
  const { models, pushSys, resume, setModel, setTheme } = d;
  const [picker, setPicker] = useState<Picker | null>(null);

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
      name: (sessionLabel(s) || "(no preview)").slice(0, 64),
      description: `${s.id.slice(0, 8)} · ${relativeTime(s.mtimeMs, now)}`,
      value: s.id,
    }));
    if (!options.length) { pushSys("no past sessions found for this directory."); return; }
    setPicker({ kind, title: "Resume a session — ↑↓ to choose · Enter to select · Esc to cancel", options });
  };

  const onPick = (opt: Opt | null) => {
    const kind = picker?.kind;
    setPicker(null);
    if (!opt || !kind) return;
    if (kind === "resume") resume(opt.value);
    else if (kind === "model") setModel(opt.value);
    else setTheme(opt.value);
  };

  const closePicker = () => setPicker(null);

  const pickerOverlay = picker ? { title: picker.title, options: picker.options, onSelect: onPick } : null;

  return { picker, openPicker, onPick, closePicker, pickerOverlay };
}
