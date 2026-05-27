// Core domain types for Ascent. Subject-agnostic — nothing here knows about ML.

/** Right-pane capability modules a lesson can declare. Core lenses are always
 *  available; `code` (and later `viz`) are opt-in per lesson. */
export type LensId = "notes" | "quiz" | "chat" | "code" | "viz";

export type ConceptStatus = "queued" | "current" | "visited" | "complete";
/** Generation lifecycle for a concept's lesson body. */
export type ConceptState = "outline" | "generating" | "ready";

/** A forkable term inside lesson prose — structured data, not parsed markdown. */
export interface Term {
  term: string;
  gloss: string;
  branchHint?: boolean;
}
export type ParagraphChunk = string | Term;

/** Typed lesson content blocks (not HTML/markdown) so they stream, render, and
 *  fork cleanly across any subject. */
export type Block =
  | { kind: "paragraph"; content: ParagraphChunk[] }
  | { kind: "callout"; label: string; text: string }
  | { kind: "media"; source: string; locator: string; label: string; sublabel?: string; note?: string }
  | { kind: "section"; label: string; hint?: string };

export interface SuggestedBranch {
  title: string;
  reason: string;
}

export interface ChatAttachment {
  kind: string;
  ref: string;
}
