// Local UI settings (no account) — tutor mode, theme, and the chosen model,
// stored in localStorage. Dependency-light: imports only the model catalog, so
// the AI service can read getModelId() without an import cycle.
import type { TutorMode } from "./generation/tutor";
import { getRoute, DEFAULT_ROUTE_ID, ROUTE_OPTIONS, type RouteModel } from "./ai/routes";
import { AI_TASKS, type AiTaskId } from "./ai/tasks";
import type { ProviderSettingsEnvelope } from "./ai/text/registry";

const TUTOR_MODE_KEY = "ascent-tutor-mode";
const ROUTE_KEY = "ascent-route";
const MODEL_KEY = "ascent-model";
const PROVIDER_SETTINGS_KEY = "ascent-provider-settings";
const THEME_KEY = "ascent-theme";
const PREVIEW_WIDTH_KEY = "ascent-preview-width";
const CHAT_PANEL_HEIGHT_KEY = "ascent-chat-panel-height";
const PDF_EXTRACTION_KEY = "ascent-pdf-extraction";

export type PdfVisionMode = "none" | "hybrid" | "full";

export interface PdfExtractionSettings {
  visionMode: PdfVisionMode;
  /** A hard spend guard. Pages beyond this limit retain their local extraction. */
  maxVisionPages: number;
}

export const DEFAULT_PDF_EXTRACTION_SETTINGS: PdfExtractionSettings = {
  visionMode: "none",
  maxVisionPages: 20,
};

export function getPdfExtractionSettings(): PdfExtractionSettings {
  const raw = localStorage.getItem(PDF_EXTRACTION_KEY);
  if (!raw) return DEFAULT_PDF_EXTRACTION_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<PdfExtractionSettings>;
    const visionMode = value.visionMode;
    const maxVisionPages = Math.round(Number(value.maxVisionPages));
    return {
      visionMode: visionMode === "hybrid" || visionMode === "full" ? visionMode : "none",
      maxVisionPages:
        Number.isFinite(maxVisionPages) && maxVisionPages > 0
          ? Math.min(maxVisionPages, 200)
          : DEFAULT_PDF_EXTRACTION_SETTINGS.maxVisionPages,
    };
  } catch {
    return DEFAULT_PDF_EXTRACTION_SETTINGS;
  }
}

export function setPdfExtractionSettings(settings: PdfExtractionSettings): void {
  localStorage.setItem(PDF_EXTRACTION_KEY, JSON.stringify(settings));
}

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

function modelSupportsTask(task: AiTaskId, model: RouteModel): boolean {
  return AI_TASKS[task].requiredCapability !== "vision" || model.capabilities.includes("vision");
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

interface StoredProviderSettings extends ProviderSettingsEnvelope {
  routeId: string;
  modelId: string;
}

export interface ResolvedModelSelection {
  routeId: string;
  modelId: string;
  providerSettings: ProviderSettingsEnvelope | null;
}

function providerSettingsKey(task?: AiTaskId): string {
  return task ? `${PROVIDER_SETTINGS_KEY}:${task}` : PROVIDER_SETTINGS_KEY;
}

function readProviderSettings(task?: AiTaskId): StoredProviderSettings | null {
  const raw = localStorage.getItem(providerSettingsKey(task));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredProviderSettings>;
    if (
      typeof value.routeId !== "string" ||
      typeof value.modelId !== "string" ||
      typeof value.adapter !== "string" ||
      typeof value.version !== "number"
    ) {
      return null;
    }
    return value as StoredProviderSettings;
  } catch {
    return null;
  }
}

function matchingProviderSettings(
  stored: StoredProviderSettings | null,
  routeId: string,
  modelId: string,
): ProviderSettingsEnvelope | null {
  if (!stored || stored.routeId !== routeId || stored.modelId !== modelId) return null;
  return { adapter: stored.adapter, version: stored.version, value: stored.value };
}

export function getModelProviderSettings(
  routeId: string = getRouteId(),
  modelId: string = getModelId(),
): ProviderSettingsEnvelope | null {
  return matchingProviderSettings(readProviderSettings(), routeId, modelId);
}

export function setModelProviderSettings(
  routeId: string,
  modelId: string,
  settings: ProviderSettingsEnvelope,
): void {
  localStorage.setItem(providerSettingsKey(), JSON.stringify({ routeId, modelId, ...settings }));
}

export function getModelSelection(): ResolvedModelSelection {
  const routeId = getRouteId();
  const modelId = getModelId();
  return { routeId, modelId, providerSettings: getModelProviderSettings(routeId, modelId) };
}

// --- Per-task overrides (tasks.ts) ---
// Resolution: explicit per-task setting → the task's registry default → the
// global pick — each step validated against the task's route catalog, so a stale
// id from another route falls through rather than being sent.

/** The route a task's requests go through. Falls back to the global route. */
export function getTaskRouteId(task: AiTaskId): string {
  const v = localStorage.getItem(`${ROUTE_KEY}:${task}`);
  const requested = getRoute(v ?? getRouteId());
  if (requested.models.some((model) => modelSupportsTask(task, model))) return requested.id;
  return ROUTE_OPTIONS.find((route) => route.models.some((model) => modelSupportsTask(task, model)))?.id ?? requested.id;
}

export function setTaskRouteId(task: AiTaskId, id: string | null) {
  if (id === null) localStorage.removeItem(`${ROUTE_KEY}:${task}`);
  else localStorage.setItem(`${ROUTE_KEY}:${task}`, id);
}

/** The model a task uses, validated against the task's route catalog. */
export function getTaskModelId(task: AiTaskId): string {
  const route = getRoute(getTaskRouteId(task));
  const inCatalog = (id: string | null | undefined): id is string =>
    !!id && route.models.some((model) => model.id === id && modelSupportsTask(task, model));
  const explicit = localStorage.getItem(`${MODEL_KEY}:${task}`);
  if (inCatalog(explicit)) return explicit;
  const fallback = AI_TASKS[task].defaultModelId;
  if (inCatalog(fallback)) return fallback;
  const global = localStorage.getItem(MODEL_KEY);
  if (inCatalog(global)) return global;
  if (inCatalog(route.defaultModelId)) return route.defaultModelId;
  return route.models.find((model) => modelSupportsTask(task, model))?.id ?? route.defaultModelId;
}

/** Persist a task's model override; null clears it (back to default/global). */
export function setTaskModelId(task: AiTaskId, id: string | null) {
  if (id === null) localStorage.removeItem(`${MODEL_KEY}:${task}`);
  else localStorage.setItem(`${MODEL_KEY}:${task}`, id);
}

export function getTaskModelProviderSettings(
  task: AiTaskId,
  routeId: string = getTaskRouteId(task),
  modelId: string = getTaskModelId(task),
): ProviderSettingsEnvelope | null {
  const taskSettings = matchingProviderSettings(readProviderSettings(task), routeId, modelId);
  if (taskSettings) return taskSettings;

  // A scenario with no explicit pin inherits the complete default selection when
  // its resolved route/model are the same. Registry-level task defaults (Haiku for
  // widgets, for example) instead receive that provider adapter's own defaults.
  if (!hasTaskOverride(task) && routeId === getRouteId() && modelId === getModelId()) {
    return getModelProviderSettings(routeId, modelId);
  }
  return null;
}

export function setTaskModelProviderSettings(
  task: AiTaskId,
  routeId: string,
  modelId: string,
  settings: ProviderSettingsEnvelope,
): void {
  localStorage.setItem(providerSettingsKey(task), JSON.stringify({ routeId, modelId, ...settings }));
}

export function getTaskModelSelection(task: AiTaskId): ResolvedModelSelection {
  const routeId = getTaskRouteId(task);
  const modelId = getTaskModelId(task);
  return {
    routeId,
    modelId,
    providerSettings: getTaskModelProviderSettings(task, routeId, modelId),
  };
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
  localStorage.removeItem(providerSettingsKey(task));
}

/** What the task would resolve to with no explicit override: its registry
 *  default if valid on the default route, else the global pick. Lets the UI
 *  label the "Use default" choice without mutating storage. */
export function getTaskInheritedModelId(task: AiTaskId): string {
  const route = getRoute(getRouteId());
  const inCatalog = (id: string | null | undefined): id is string =>
    !!id && route.models.some((model) => model.id === id && modelSupportsTask(task, model));
  const fallback = AI_TASKS[task].defaultModelId;
  if (inCatalog(fallback)) return fallback;
  const global = localStorage.getItem(MODEL_KEY);
  if (inCatalog(global)) return global;
  if (inCatalog(route.defaultModelId)) return route.defaultModelId;
  return route.models.find((model) => modelSupportsTask(task, model))?.id ?? route.defaultModelId;
}

const WEBSEARCH_KEY = "ascent-websearch-enabled";
/** Web search master switch (spec §8). Default ON (the user's auto-on-every-lesson choice). When
 *  off, grounding returns "" and the resources lens is hidden — it sits ABOVE provider config, so
 *  this single flag disables the whole feature regardless of which providers are enabled. */
export function isWebSearchEnabled(): boolean {
  return localStorage.getItem(WEBSEARCH_KEY) !== "false";
}
export function setWebSearchEnabled(on: boolean): void {
  localStorage.setItem(WEBSEARCH_KEY, on ? "true" : "false");
}

const COMPLETENESS_KEY = "ascent-completeness-pass";
/** Legacy flag for the old zero-visual completeness pass. The active visual-quality audit
 *  uses VISUAL_AUDIT_KEY below; keep these accessors so older local settings don't break. */
export function isCompletenessPassEnabled(): boolean {
  return localStorage.getItem(COMPLETENESS_KEY) === "true";
}
export function setCompletenessPassEnabled(on: boolean): void {
  localStorage.setItem(COMPLETENESS_KEY, on ? "true" : "false");
}

const VISUAL_AUDIT_KEY = "ascent-visual-audit";
/** Visual audit/repair pass. Default ON because Ascent's lesson identity is hyper-visual:
 *  the pass is not deterministic routing; it asks a director model whether the lesson's
 *  own mechanisms, comparisons, and transformations have enough visual teaching support. */
export function isVisualAuditEnabled(): boolean {
  return localStorage.getItem(VISUAL_AUDIT_KEY) !== "false";
}
export function setVisualAuditEnabled(on: boolean): void {
  localStorage.setItem(VISUAL_AUDIT_KEY, on ? "true" : "false");
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
