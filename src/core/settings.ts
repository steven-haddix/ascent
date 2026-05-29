// Local UI settings (no account) — tutor mode, theme, and the chosen model,
// stored in localStorage. Dependency-light: imports only the model catalog, so
// the AI service can read getModelId() without an import cycle.
import type { TutorMode } from "./generation/tutor";
import { getRoute, DEFAULT_ROUTE_ID } from "./ai/routes";

const TUTOR_MODE_KEY = "ascent-tutor-mode";
const ROUTE_KEY = "ascent-route";
const MODEL_KEY = "ascent-model";
const THEME_KEY = "ascent-theme";
const PREVIEW_WIDTH_KEY = "ascent-preview-width";

/** Width bounds (px) for the resizable right preview panel. */
export const PREVIEW_WIDTH = { min: 360, max: 820, default: 440 } as const;

export function getPreviewWidth(): number {
  const v = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
  if (!Number.isFinite(v) || v <= 0) return PREVIEW_WIDTH.default;
  return Math.min(PREVIEW_WIDTH.max, Math.max(PREVIEW_WIDTH.min, v));
}

export function setPreviewWidth(px: number) {
  localStorage.setItem(PREVIEW_WIDTH_KEY, String(Math.round(px)));
}

export function getTutorMode(): TutorMode {
  const v = localStorage.getItem(TUTOR_MODE_KEY);
  return v === "Socratic" || v === "Encyclopedic" ? v : "Mentor";
}

export function setTutorMode(mode: TutorMode) {
  localStorage.setItem(TUTOR_MODE_KEY, mode);
}

/** The active provider/route (routes.ts). Defaults to Anthropic; set in Settings. */
export function getRouteId(): string {
  return localStorage.getItem(ROUTE_KEY) || DEFAULT_ROUTE_ID;
}

export function setRouteId(id: string) {
  localStorage.setItem(ROUTE_KEY, id);
}

/** The model used for all generation, validated against the active route's catalog
 *  (a stale id from a different route falls back to that route's default). */
export function getModelId(): string {
  const route = getRoute(getRouteId());
  const v = localStorage.getItem(MODEL_KEY);
  return route.models.some((m) => m.id === v) ? (v as string) : route.defaultModelId;
}

export function setModelId(id: string) {
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
