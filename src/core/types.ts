// Core domain types for Ascent. Subject-agnostic — nothing here knows about ML.

/** Right-pane capability modules a lesson can declare. Core lenses are always
 *  available; `code`/`viz` are opt-in per lesson. `resources` is data-driven — the
 *  preview pane appends it when web-search resources exist (not declared by the
 *  generator). `library` is the topic's knowledge library, always offered. */
export type LensId = "notes" | "quiz" | "chat" | "teach" | "code" | "viz" | "resources" | "library";

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
 *  (math / diagram / table / chart) render inline in the lesson body. A `widget`
 *  block is a PLACEHOLDER: the generator emits only an id + title + spec, and a
 *  separate cheaper agent builds the actual component into the `widgets` table
 *  (keyed conceptId + widgetId) while the lesson keeps streaming. */
export interface Block {
  kind:
    | "paragraph"
    | "callout"
    | "section"
    | "code"
    | "math"
    | "diagram"
    | "table"
    | "chart"
    | "widget"
    | "timeline"
    | "spectrum"
    | "figure"
    | "graph"
    | "map"
    | "media"
    | "generated-image";
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
  /** for `widget`: short kebab slug, unique within the lesson (normalized app-side
   *  via widgetKeysFor — render and job-kickoff always go through that helper) */
  widgetId?: string;
  /** for `widget`: 2-5 sentences specifying the interaction — the builder agent
   *  sees ONLY this (plus concept context), never the lesson prose */
  spec?: string;
  /** accessibility: a one-line text alternative for any visual block (timeline/spectrum/etc.) */
  alt?: string;
  /** for `timeline`: events on a time/era axis */
  events?: { at: string; label: string; detail?: string }[];
  /** for `timeline`: optional named lanes/tracks to group events */
  lanes?: string[];
  /** for `spectrum`: the continuum axis (numeric range + optional tick labels) */
  axis?: { min: number; max: number; labels?: string[] };
  /** for `spectrum`: items placed along the axis at position `at` (within axis min..max) */
  items?: { label: string; at: number }[];
  /** for `figure`: a base visual — a model-drawn vector scene (`svg`, viewBox 0 0 100 100)
   *  or a provider-sourced image (`mediaId`, resolved by a job into media_assets) */
  figure?: { svg?: string; mediaId?: string };
  /** for `figure`: callout labels pointing at parts of the base visual, at 0..100 coords */
  labels?: { text: string; at: { x: number; y: number } }[];
  /** for `graph`: node–link nodes (model emits data, app renders with d3-force) */
  nodes?: { id: string; label?: string; group?: string }[];
  /** for `graph`: directed/undirected edges between node ids */
  edges?: { from: string; to: string; label?: string }[];
  /** for `map`: the geographic projection / basemap to render */
  projection?: "world" | "mercator" | "albersUsa";
  /** for `map`: marks placed on the basemap — a pin at [lon,lat] or a named region */
  marks?: { kind: "pin" | "region"; coords?: [number, number]; region?: string; label?: string; value?: number }[];
  /** for `media` (and provider-sourced `figure`): a slug unique within the lesson; a job
   *  resolves the asset into the media_assets table (keyed conceptId + mediaId) */
  mediaId?: string;
  /** for `media`: the search query the resolve job sends to a media provider */
  query?: string;
  /** for `generated-image`: the self-contained image-generation prompt */
  prompt?: string;
  /** for `media`: what the asset is for (helps ranking + alt text); free text */
  purpose?: string;
}

/** Lifecycle of a built widget (the `widgets` table row a `widget` block points
 *  to). `generating` covers the whole generate→compile loop; `failed` is terminal
 *  until a manual Retry. */
export type WidgetStatus = "generating" | "ready" | "failed";

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

/** One concept already in a topic, offered to a generator (lesson or teach-back) so
 *  it can link to it instead of duplicating it. `handle` is a short stable id the
 *  model cites; `conceptId` stays app-side for resolution (never sent to the model). */
export interface ExistingConcept {
  handle: string;
  conceptId: string;
  title: string;
  summary: string | null;
}

export interface ChatAttachment {
  kind: string;
  ref: string;
}

/** A learner's own highlight over lesson prose — the personal annotation layer
 *  alongside the LLM's forkable terms. Anchored by quote + context
 *  (TextQuoteSelector): `exact` is the selected text; `prefix`/`suffix` are a few
 *  characters of surrounding block text used to re-locate it on render. `gloss`
 *  is filled lazily by "Define inline". */
export interface Highlight {
  id: string;
  conceptId: string;
  exact: string;
  prefix: string;
  suffix: string;
  gloss: string | null;
  createdAt: number;
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

/** A concept the learner missed. The grader may match it to a concept already in the
 *  tree (`conceptId` set) — surfaced as a Link to revisit — or leave it new, surfaced
 *  as a Fork the learner can create on click. Not auto-forked. */
export interface TeachGap {
  title: string;
  reason: string;
  /** set when the grader matched this gap to an existing concept (the link target);
   *  absent/null = a genuinely new gap the learner can fork. */
  conceptId?: string | null;
}

// --- Topic intake (the questionnaire that refines a topic before generation) ---

/** A single AI-authored multiple-choice question in the topic intake. */
export interface IntakeQuestion {
  /** the question text */
  prompt: string;
  /** 3-5 distinct choices */
  options: string[];
  /** short 1-3 word label for the Brief panel facet this answer fills (e.g.
   *  "Motivation", "Math depth", "Scope") */
  facetLabel?: string;
  /** when the question is grounded in a specific attached document, its title —
   *  rendered as a provenance chip ("from rl-course-syllabus.md") */
  source?: string;
}

/** One answered intake question — kept as grounding for generation. At least one
 *  of `selected` / `other` is set. */
export interface IntakeAnswer {
  prompt: string;
  /** the chosen option, if any */
  selected?: string;
  /** free-text the learner added, if any (supplements or replaces a selection) */
  other?: string;
  /** carried over from the question — lets the brief build labeled facets */
  facetLabel?: string;
}

/** The persisted intake result — threaded into all generation for a topic. */
export interface TopicBrief {
  /** the AI's 2-4 sentence synthesized understanding of what to build */
  summary: string;
  /** the Q&A transcript */
  answers: IntakeAnswer[];
  /** labeled answer facets for the Brief panel (topic-creation design): e.g.
   *  {label: "Motivation", value: "A course I'm taking right now"} */
  facets?: { label: string; value: string }[];
  /** library documentIds the topic was grounded in at creation time */
  groundedIn?: number[];
}

// --- Continuity Engine (Course Canon + Lesson Digest) ---

/** A compact, structured summary of what a lesson actually established — produced
 *  by a cheap post-stream call (NOT part of LessonSchema), stored on the lesson row
 *  and merged back into the Course Canon (B2). */
export interface LessonDigest {
  /** 1-2 sentences: what the learner knows after this lesson */
  recap: string;
  /** analogies / mental models introduced (e.g. "loss surface as terrain") */
  motifs: string[];
  /** symbols/terms this lesson pinned down */
  notation: { symbol: string; means: string }[];
  /** questions raised but deliberately not answered here */
  openLoops: string[];
  /** sub-topics this lesson explicitly leaves to deeper lessons */
  deferredTo: string[];
  /** concepts this lesson built on (titles or handles) */
  assumedPrereqs: string[];
}

/** A canonical symbol/term in a topic's notation registry — stable across lessons. */
export interface CanonNotation {
  symbol: string;
  means: string;
  firstIntroducedIn?: string | null;
}

/** A through-line (1-3 per topic) and the spine example that evolves across lessons. */
export interface CanonMotif {
  name: string;
  description: string;
  lastAdvancedIn?: string | null;
}

/** The narrative arc of a topic + an ordered list of its concepts (B1 spine). */
export interface CanonSpine {
  arc: string;
  /** ordered concept ids along the spine */
  order: string[];
}

/** The one-author tone/depth/pacing charter for a topic. */
export interface CanonVoice {
  tone: string;
  depth: string;
  pacing: string;
}

/** A one-step-undo snapshot of a lesson body, captured before a self-heal revision (B6). */
export interface LessonSnapshot {
  subtitle: string | null;
  blocks: Block[];
}

// --- Knowledge library (knowledge-backbone plan §4) ---

/** Descriptive metadata for a library document (all optional, provider-dependent). */
export interface DocumentMeta {
  publishedAt?: string;
  domain?: string;
  license?: string;
  pageCount?: number;
  extraction?: {
    visionMode: "none" | "hybrid" | "full";
    localAdapterVersion: number;
    routeId?: string;
    modelId?: string;
    pages: Array<{
      page: number;
      provenance: "pdfjs" | "vision";
      quality: "good" | "weak" | "empty";
      warnings: string[];
    }>;
  };
}

/** The distilled learner profile — who the user is, independent of any topic.
 *  Produced by the `profile` task from uploaded background docs (resume, bio). */
export interface LearnerProfileSummary {
  background: string;
  roles: string[];
  skills: string[];
  goals: string[];
  priorKnowledge: string[];
}
