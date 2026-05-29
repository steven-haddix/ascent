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

/** A point in a chart series. `x` may be numeric (line/scatter/area) or a
 *  category label (bar). */
export interface ChartPoint {
  x: number | string;
  y: number;
}

/** One labeled data series in a chart. */
export interface ChartSeries {
  name?: string;
  points: ChartPoint[];
}

/** A typed lesson content block. Flat shape (kind + optional fields) keeps it
 *  reliable for structured generation and simple to render. Visual kinds
 *  (math / diagram / table / chart) render inline in the lesson body. */
export interface Block {
  kind: "paragraph" | "callout" | "section" | "code" | "math" | "diagram" | "table" | "chart";
  /** paragraph/callout body, code source, LaTeX (for `math`), or Mermaid spec (for `diagram`) */
  text?: string;
  /** callout label (e.g. "Notice") or section label */
  label?: string;
  /** optional section hint */
  hint?: string;
  /** for paragraphs: key terms in the text a learner can fork into */
  terms?: Term[];
  /** for `code`: language hint (e.g. "python", "javascript", "bash") */
  language?: string;
  /** for `code`/`diagram`/`table`/`chart`: a short caption/title */
  title?: string;
  /** marks blocks the chat tutor added on request, so the chat tool can find and
   *  replace the most recent chat-added snippet in place instead of stacking. */
  source?: "chat";
  /** for `table`: column headers */
  headers?: string[];
  /** for `table`: rows, each a list of cells aligned to `headers` */
  rows?: string[][];
  /** for `chart`: how to plot the series */
  chartType?: "line" | "bar" | "scatter" | "area";
  /** for `chart`: one or more data series */
  series?: ChartSeries[];
  /** for `chart`: axis labels */
  xLabel?: string;
  yLabel?: string;
}

/** A net-new sub-concept the lesson recommends creating — a true fork, nested
 *  under the current concept. Only for ideas absent from the topic's tree. */
export interface SuggestedFork {
  title: string;
  reason: string;
}

/** A pointer to a concept that already exists in this topic — a link, not a new
 *  node. The model returns a handle during generation; we resolve it to this
 *  persisted form (`conceptId`) before storing it on the lesson. */
export interface SuggestedLesson {
  conceptId: string;
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

// --- Topic intake (the questionnaire that refines a topic before generation) ---

/** A single AI-authored multiple-choice question in the topic intake. */
export interface IntakeQuestion {
  /** the question text */
  prompt: string;
  /** 3-5 distinct choices */
  options: string[];
}

/** One answered intake question — kept as grounding for generation. At least one
 *  of `selected` / `other` is set. */
export interface IntakeAnswer {
  prompt: string;
  /** the chosen option, if any */
  selected?: string;
  /** free-text the learner added, if any (supplements or replaces a selection) */
  other?: string;
}

/** The persisted intake result — threaded into all generation for a topic. */
export interface TopicBrief {
  /** the AI's 2-4 sentence synthesized understanding of what to build */
  summary: string;
  /** the Q&A transcript */
  answers: IntakeAnswer[];
}
