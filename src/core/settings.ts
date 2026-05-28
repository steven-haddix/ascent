// Local UI settings (no account) — tutor mode, theme, and the chosen model,
// stored in localStorage. Dependency-light: imports only the model catalog, so
// the AI service can read getModelId() without an import cycle.
import type { TutorMode } from "./generation/tutor";
import { MODELS, MODEL_OPTIONS, type ModelId } from "./ai/models";

const TUTOR_MODE_KEY = "ascent-tutor-mode";
const MODEL_KEY = "ascent-model";
const THEME_KEY = "ascent-theme";

export function getTutorMode(): TutorMode {
  const v = localStorage.getItem(TUTOR_MODE_KEY);
  return v === "Socratic" || v === "Encyclopedic" ? v : "Mentor";
}

export function setTutorMode(mode: TutorMode) {
  localStorage.setItem(TUTOR_MODE_KEY, mode);
}

/** The model used for all generation. Defaults to Sonnet; overridden in Settings. */
export function getModelId(): ModelId {
  const v = localStorage.getItem(MODEL_KEY);
  return MODEL_OPTIONS.some((m) => m.id === v) ? (v as ModelId) : MODELS.default;
}

export function setModelId(id: ModelId) {
  localStorage.setItem(MODEL_KEY, id);
}

export const THEMES = ["cream", "paper", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function getTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY);
  return v === "paper" || v === "dark" ? v : "cream";
}

/** Apply a theme to <html> (data-theme drives the token overrides; .dark drives
 *  Shiki's dark code theme and the `dark:` variant). Does not persist. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function setTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}
