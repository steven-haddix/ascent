// Core domain types for Ascent. Subject-agnostic — nothing here knows about ML.

/** Right-pane capability modules a lesson can declare. Core lenses are always
 *  available; `code` (and later `viz`) are opt-in per lesson. */
export type LensId = "notes" | "quiz" | "chat" | "teach" | "code" | "viz";

export type ConceptStatus = "queued" | "current" | "visited" | "complete";
/** Generation lifecycle for a concept's lesson body. */
export type ConceptState = "outline" | "generating" | "ready";

/** A forkable term — appears in a paragraph's text and can be branched into. */
export interface Term {
  term: string;
  gloss: string;
}

/** A typed lesson content block. Flat shape (kind + optional fields) keeps it
 *  reliable for structured generation and simple to render. */
export interface Block {
  kind: "paragraph" | "callout" | "section" | "code";
  /** paragraph body, callout body, or code source (for `code`) */
  text?: string;
  /** callout label (e.g. "Notice") or section label */
  label?: string;
  /** optional section hint */
  hint?: string;
  /** for paragraphs: key terms in the text a learner can fork into */
  terms?: Term[];
  /** for `code`: language hint (e.g. "python", "javascript", "bash") */
  language?: string;
}

export interface SuggestedBranch {
  title: string;
  reason: string;
}

export interface ChatAttachment {
  kind: string;
  ref: string;
}

// --- Feynman teach-back ---

/** Who the learner explains to — shapes how the grader weights the rubric. */
export type TeachAudience = "child" | "peer" | "expert";

/** Teach-back rubric — each dimension scored 0..1. */
export interface RubricScores {
  clarity: number;
  accuracy: number;
  completeness: number;
  /** quality of the underlying mental model (analogies, intuition, connections) */
  model: number;
}

/** A span of the learner's explanation, marked by the grader. */
export interface TeachAnnotation {
  /** verbatim substring of the explanation, so the UI can re-highlight it in place */
  text: string;
  kind: "strong" | "vague" | "gap";
  note: string;
}

/** A concept the learner missed — auto-forked into the tree as a remedial branch. */
export interface TeachGap {
  title: string;
  reason: string;
}
