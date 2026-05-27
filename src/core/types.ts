// Core domain types for Ascent. Subject-agnostic — nothing here knows about ML.

/** Right-pane capability modules a lesson can declare. Core lenses are always
 *  available; `code` (and later `viz`) are opt-in per lesson. */
export type LensId = "notes" | "quiz" | "chat" | "code" | "viz";

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
  kind: "paragraph" | "callout" | "section";
  /** paragraph body or callout body */
  text?: string;
  /** callout label (e.g. "Notice") or section label */
  label?: string;
  /** optional section hint */
  hint?: string;
  /** for paragraphs: key terms in the text a learner can fork into */
  terms?: Term[];
}

export interface SuggestedBranch {
  title: string;
  reason: string;
}

export interface ChatAttachment {
  kind: string;
  ref: string;
}
