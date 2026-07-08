// Palette registry. Switch at runtime with /theme; the choice persists via config.ts.

export type Theme = {
  name: string;
  label: string; // human description for the picker
  bg: string;
  panel: string;
  accent: string; // primary brand / labels
  accentDim: string; // borders, hints
  ink: string; // body text
  muted: string; // secondary text
  user: string; // "YOU" label / user message accent bar
  userBg: string; // shaded background behind a user message
  sys: string; // "SYS" system-line label
  ok: string; // good status (auth=none)
  warn: string; // bad status / errors
};

// Warm gold on near-black — the original.
export const amber: Theme = {
  name: "amber", label: "warm gold, dark",
  bg: "#0e0d0b", panel: "#16140f", accent: "#e8a33d", accentDim: "#8a6a2e",
  ink: "#e8e2d4", muted: "#6b6455", user: "#7fb0c9", userBg: "#141b20", sys: "#9a8bb0",
  ok: "#7fc98a", warn: "#c97f7f",
};

// Deep navy — dark with a strong blue tint and a bright electric-blue accent.
export const navy: Theme = {
  name: "navy", label: "deep navy blue",
  bg: "#0a1626", panel: "#12233b", accent: "#4fa8ff", accentDim: "#2d557f",
  ink: "#dbe8f7", muted: "#6a7f99", user: "#7fc4ff", userBg: "#132539", sys: "#9fb8dc",
  ok: "#5fd08a", warn: "#ff6b6b",
};

// Phosphor green on black — the terminal classic.
export const matrix: Theme = {
  name: "matrix", label: "phosphor green",
  bg: "#04120a", panel: "#0a1f12", accent: "#39ff6a", accentDim: "#1f7a3a",
  ink: "#c5ffd6", muted: "#4f7a5c", user: "#8affb6", userBg: "#0a2414", sys: "#6ad48f",
  ok: "#39ff6a", warn: "#ff5f56",
};

// Pink — vibrant hot-pink accents on a deep plum, soft and playful.
export const rose: Theme = {
  name: "rose", label: "vibrant pink",
  bg: "#1f0f1a", panel: "#2e1626", accent: "#ff8fd0", accentDim: "#b0678f",
  ink: "#ffe3f2", muted: "#9a7488", user: "#ffb3e0", userBg: "#341a2b", sys: "#e0a3ff",
  ok: "#86e0b0", warn: "#ff6f91",
};

export const THEMES: Record<string, Theme> = { amber, navy, matrix, rose };
export const THEME_NAMES = Object.keys(THEMES);
export const DEFAULT_THEME = "amber";

export function getTheme(name: string | undefined): Theme {
  return (name && THEMES[name]) || amber;
}

// "claude-opus-4-8[1m]" -> "opus-4.8[1m]"
export function shortModel(model: string): string {
  return model.replace(/^claude-/, "").replace(/(\d)-(\d)/g, "$1.$2");
}
