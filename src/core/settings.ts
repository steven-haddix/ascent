// Local UI settings (no account) — tutor mode, theme, and the chosen model,
// stored in localStorage. Dependency-light: imports only the model catalog, so
// the AI service can read getModelId() without an import cycle.
import type { TutorMode } from "./generation/tutor";
import { getRoute, DEFAULT_ROUTE_ID } from "./ai/routes";
import { AI_TASKS, type AiTaskId } from "./ai/tasks";

const TUTOR_MODE_KEY = "ascent-tutor-mode";
const ROUTE_KEY = "ascent-route";
const MODEL_KEY = "ascent-model";
const THEME_KEY = "ascent-theme";
const PREVIEW_WIDTH_KEY = "ascent-preview-width";
const CHAT_PANEL_HEIGHT_KEY = "ascent-chat-panel-height";

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

/** Height bounds (px) for the resizable chat conversation panel. `max` is also
 *  clamped to a fraction of the viewport at drag time. */
export const CHAT_PANEL_HEIGHT = { min: 220, max: 720, default: 340 } as const;

export function getChatPanelHeight(): number {
  const v = Number(localStorage.getItem(CHAT_PANEL_HEIGHT_KEY));
  if (!Number.isFinite(v) || v <= 0) return CHAT_PANEL_HEIGHT.default;
  return Math.min(CHAT_PANEL_HEIGHT.max, Math.max(CHAT_PANEL_HEIGHT.min, v));
}

export function setChatPanelHeight(px: number) {
  localStorage.setItem(CHAT_PANEL_HEIGHT_KEY, String(Math.round(px)));
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

// --- Per-task overrides (tasks.ts) ---
// Resolution: explicit per-task setting → the task's registry default → the
// global pick — each step validated against the task's route catalog, so a stale
// id from another route falls through rather than being sent.

/** The route a task's requests go through. Falls back to the global route. */
export function getTaskRouteId(task: AiTaskId): string {
  const v = localStorage.getItem(`${ROUTE_KEY}:${task}`);
  return v ?? getRouteId();
}

export function setTaskRouteId(task: AiTaskId, id: string | null) {
  if (id === null) localStorage.removeItem(`${ROUTE_KEY}:${task}`);
  else localStorage.setItem(`${ROUTE_KEY}:${task}`, id);
}

/** The model a task uses, validated against the task's route catalog. */
export function getTaskModelId(task: AiTaskId): string {
  const route = getRoute(getTaskRouteId(task));
  const inCatalog = (id: string | null | undefined): id is string =>
    !!id && route.models.some((m) => m.id === id);
  const explicit = localStorage.getItem(`${MODEL_KEY}:${task}`);
  if (inCatalog(explicit)) return explicit;
  const fallback = AI_TASKS[task].defaultModelId;
  if (inCatalog(fallback)) return fallback;
  const global = localStorage.getItem(MODEL_KEY);
  return inCatalog(global) ? global : route.defaultModelId;
}

/** Persist a task's model override; null clears it (back to default/global). */
export function setTaskModelId(task: AiTaskId, id: string | null) {
  if (id === null) localStorage.removeItem(`${MODEL_KEY}:${task}`);
  else localStorage.setItem(`${MODEL_KEY}:${task}`, id);
}

/** True when the user has explicitly pinned this task's provider or model
 *  (as opposed to inheriting the default — possibly via a registry default). */
export function hasTaskOverride(task: AiTaskId): boolean {
  return (
    localStorage.getItem(`${MODEL_KEY}:${task}`) !== null ||
    localStorage.getItem(`${ROUTE_KEY}:${task}`) !== null
  );
}

/** Clear a task's provider + model pins so it follows the default again. */
export function clearTaskOverride(task: AiTaskId) {
  localStorage.removeItem(`${MODEL_KEY}:${task}`);
  localStorage.removeItem(`${ROUTE_KEY}:${task}`);
}

/** What the task would resolve to with no explicit override: its registry
 *  default if valid on the default route, else the global pick. Lets the UI
 *  label the "Use default" choice without mutating storage. */
export function getTaskInheritedModelId(task: AiTaskId): string {
  const route = getRoute(getRouteId());
  const inCatalog = (id: string | null | undefined): id is string =>
    !!id && route.models.some((m) => m.id === id);
  const fallback = AI_TASKS[task].defaultModelId;
  if (inCatalog(fallback)) return fallback;
  const global = localStorage.getItem(MODEL_KEY);
  return inCatalog(global) ? global : route.defaultModelId;
}

const COMPLETENESS_KEY = "ascent-completeness-pass";
/** Visual completeness pass (§3b) — gated, default OFF. Enable only if spike #5 shows the
 *  domain budget (§3a) alone left real coverage gaps; otherwise we don't carry the 2nd pass. */
export function isCompletenessPassEnabled(): boolean {
  return localStorage.getItem(COMPLETENESS_KEY) === "true";
}
export function setCompletenessPassEnabled(on: boolean): void {
  localStorage.setItem(COMPLETENESS_KEY, on ? "true" : "false");
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
