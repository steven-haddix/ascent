// AI task registry — every distinct AI use case in the app gets an addressable
// id, so its model/provider can diverge from the global pick without touching
// call sites (Settings reads this to offer per-task overrides). Dependency-light
// (models.ts only, like routes.ts) so settings/service import it without cycles.
//
// Migration policy: only `widget` resolves through getModelFor() today; the other
// ids are reserved so existing getModel() call sites can migrate one at a time as
// each earns a settings knob.
import { MODELS } from "./models";

/** The class of model capability a task requires. Absent on a task = "textGeneration". */
export type AiCapability = "textGeneration" | "embeddings" | "vision";

export type AiTaskId =
  | "lesson"
  | "widget"
  | "tutor"
  | "teachback"
  | "quiz"
  | "micro"
  | "intake"
  | "outline"
  | "canon"
  | "digest"
  | "coherence"
  | "revise"
  | "embed"
  | "director"
  | "figure"
  | "websearch";

export interface AiTask {
  id: AiTaskId;
  label: string;
  /** Preferred model when the user hasn't overridden this task (validated against
   *  the task's route catalog at read time). Absent = inherit the global pick. */
  defaultModelId?: string;
  /** Model capability required by this task. Absent = "textGeneration". */
  requiredCapability?: AiCapability;
}

export const AI_TASKS: Record<AiTaskId, AiTask> = {
  lesson: { id: "lesson", label: "Lessons" },
  // Widgets are built by a separate, cheaper agent off a short spec — Haiku by
  // default; the retry loop + tight contract absorb its rougher code. If quality
  // disappoints, switching widgets to Sonnet is a Settings change, not code.
  widget: { id: "widget", label: "Widgets", defaultModelId: MODELS.fast },
  tutor: { id: "tutor", label: "Chat tutor" },
  teachback: { id: "teachback", label: "Teach-back grading" },
  quiz: { id: "quiz", label: "Quizzes" },
  micro: { id: "micro", label: "Inline definitions" },
  intake: { id: "intake", label: "Topic intake" },
  outline: { id: "outline", label: "Topic outlines" },
  canon: { id: "canon", label: "Course canon", requiredCapability: "textGeneration" },
  digest: { id: "digest", label: "Lesson digests", defaultModelId: MODELS.fast, requiredCapability: "textGeneration" },
  coherence: { id: "coherence", label: "Coherence drift-check", defaultModelId: MODELS.fast, requiredCapability: "textGeneration" },
  revise: { id: "revise", label: "Lesson revision", requiredCapability: "textGeneration" },
  embed: { id: "embed", label: "Embeddings", requiredCapability: "embeddings" },
  director: { id: "director", label: "Visual completeness", defaultModelId: MODELS.fast, requiredCapability: "textGeneration" },
  figure: { id: "figure", label: "Figure generation", defaultModelId: MODELS.fast, requiredCapability: "textGeneration" },
  // The native search-only call (anthropicNative) — a text model + the web_search server tool.
  // Cheap by default (Haiku); the FEATURE gate is hasSearchCapability() in search/registry, not here.
  websearch: { id: "websearch", label: "Web search", defaultModelId: MODELS.fast, requiredCapability: "textGeneration" },
};

/** Returns the capability required by a task; defaults to "textGeneration" when absent. */
export function requiredCapabilityOf(id: AiTaskId): AiCapability {
  return AI_TASKS[id].requiredCapability ?? "textGeneration";
}
