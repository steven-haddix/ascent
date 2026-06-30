// Visual Registry — the authoring facet (Visual Learning System §2). For each visual
// kind the registry adds beyond today's inline set, this holds (a) the prompt-fragment
// guidance assembled into the lesson prompt's FORMAT section and (b) the Zod fields it
// contributes to the lesson block schema. New visual kinds become plugins here instead
// of edits to a hand-maintained wall of text in the generator (the load-bearing payoff).
//
// Today's pre-registry kinds (chart/diagram/widget/code/table/math) stay inline in
// lessonPrompt + lessonSchema; the registry owns the ADDITIVE kinds (timeline, spectrum
// now; figure/graph/map/media as later waves land them).
import { z } from "zod";
import type { VisualKind } from "./catalog";

export interface VisualPromptDefinition {
  kind: VisualKind;
  /** prompt-fragment bullet assembled into the lesson prompt's FORMAT section */
  guidance: string;
  /** Zod fields this kind contributes to the lesson block schema (merged into the block object) */
  schema: z.ZodRawShape;
}

const altField = z
  .string()
  .optional()
  .describe("a one-line text alternative describing the visual, for accessibility");

export const visualAuthoring: Partial<Record<VisualKind, VisualPromptDefinition>> = {
  timeline: {
    kind: "timeline",
    guidance: `- A "timeline" block places events on a time/era axis — REACH FOR IT for history, a biography, the evolution of an idea, or any narrative with chronology. Set \`events\` (each {at, label, detail?}) where \`at\` is a short date/era label ("1914", "Late Bronze Age", "Act II") and \`label\` names what happened; optional \`lanes\` group parallel tracks. Always set a one-line \`alt\` describing the sequence. Prefer it over a prose list of dates.`,
    schema: {
      events: z
        .array(z.object({ at: z.string(), label: z.string(), detail: z.string().optional() }))
        .optional()
        .describe('for `timeline` blocks ONLY: events on an axis, each {at (short date/era label e.g. "1914"), label, optional detail}'),
      lanes: z
        .array(z.string())
        .optional()
        .describe("for `timeline` blocks ONLY: optional named lanes/tracks to group parallel events"),
      alt: altField,
    },
  },
  spectrum: {
    kind: "spectrum",
    guidance: `- A "spectrum" block places items along a continuum — REACH FOR IT for a political spectrum, a scale (e.g. Mohs hardness), a gradient of positions, or any "where does X sit between two poles". Set \`axis\` ({min, max, optional end/tick labels}) and \`items\` (each {label, at} with \`at\` between min and max). Always set a one-line \`alt\`. Prefer it over prose when the point is relative position.`,
    schema: {
      axis: z
        .object({ min: z.number(), max: z.number(), labels: z.array(z.string()).optional() })
        .optional()
        .describe("for `spectrum` blocks ONLY: the continuum (numeric min/max + optional end/tick labels)"),
      items: z
        .array(z.object({ label: z.string(), at: z.number() }))
        .optional()
        .describe("for `spectrum` blocks ONLY: items placed along the axis at position `at` (within min..max)"),
      alt: altField,
    },
  },
  figure: {
    kind: "figure",
    guidance: `- A "figure" block is a LABELED DIAGRAM — the workhorse for "the parts of X" (anatomy, a cathedral, a cell, a sonnet's structure, a machine, a neural network layer, a tensor-shape transform, a model architecture). Draw a clean schematic in \`figure.svg\` as a SELF-CONTAINED SVG with viewBox="0 0 100 100" (simple shapes/paths/strokes; muted fills or currentColor; NO <script>, NO external images, NO raster). Add \`labels\` (each {text, at:{x,y}} in 0..100 coords) pointing at the parts. Always set a one-line \`alt\`. Reach for it where a picture of structure teaches faster than prose.`,
    schema: {
      figure: z
        .object({ svg: z.string().optional(), mediaId: z.string().optional() })
        .optional()
        .describe('for `figure` blocks ONLY: the base visual — `svg` is a self-contained SVG with viewBox "0 0 100 100"'),
      labels: z
        .array(z.object({ text: z.string(), at: z.object({ x: z.number(), y: z.number() }) }))
        .optional()
        .describe("for `figure` blocks ONLY: callout labels at 0..100 coords pointing at parts of the figure"),
      alt: altField,
    },
  },
  graph: {
    kind: "graph",
    guidance: `- A "graph" block shows node–link RELATIONSHIPS — causes/influences, who-shaped-whom, a taxonomy, a dependency web. Emit \`nodes\` (each {id, label?, group?}) and \`edges\` (each {from, to, label?} referencing node ids). The app lays it out (force-directed) — you emit DATA, never coordinates. Always set a one-line \`alt\`. Reach for it when the point is how things connect, not a sequence or a quantity.`,
    schema: {
      nodes: z
        .array(z.object({ id: z.string(), label: z.string().optional(), group: z.string().optional() }))
        .optional()
        .describe("for `graph` blocks ONLY: nodes, each {id, optional label, optional group for coloring}"),
      edges: z
        .array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() }))
        .optional()
        .describe("for `graph` blocks ONLY: edges between node ids, each {from, to, optional label}"),
      alt: altField,
    },
  },
  map: {
    kind: "map",
    guidance: `- A "map" block places marks on a geographic basemap — locations or routes. Set \`projection\` ("world" or "mercator") and \`marks\` (each {kind:"pin", coords:[lon,lat], label?}). The app renders the basemap and projects your marks — you emit DATA, never geometry. Always set a one-line \`alt\`. Reach for it for anything inherently spatial.`,
    schema: {
      projection: z
        .enum(["world", "mercator", "albersUsa"])
        .optional()
        .describe("for `map` blocks ONLY: the basemap projection (default world)"),
      marks: z
        .array(
          z.object({
            kind: z.enum(["pin", "region"]),
            coords: z.tuple([z.number(), z.number()]).optional(),
            region: z.string().optional(),
            label: z.string().optional(),
            value: z.number().optional(),
          }),
        )
        .optional()
        .describe("for `map` blocks ONLY: marks — a pin at [lon,lat] (optional label)"),
      alt: altField,
    },
  },
  media: {
    kind: "media",
    guidance: `- A "media" block places a REAL provider-sourced image (a historical photo, an artwork, a portrait, a specimen) — reach for it when an authentic image teaches better than a drawing. Set a short, specific \`title\` (3-7 words), a stable \`mediaId\` (kebab slug, unique in this lesson), a precise \`query\` (what to search for), and a one-line \`purpose\` (also used as alt text). A job resolves and caches it with attribution; you NEVER write a URL.`,
    schema: {
      mediaId: z.string().optional().describe("for `media` blocks ONLY: a kebab-case slug unique within this lesson"),
      query: z.string().optional().describe("for `media` blocks ONLY: the image search query"),
      purpose: z.string().optional().describe("for `media` blocks ONLY: what the image is for (also used as alt text)"),
      alt: altField,
    },
  },
  "generated-image": {
    kind: "generated-image",
    guidance: `- A "generated-image" block creates a rich AI-GENERATED ILLUSTRATION — use it for a scene, visual analogy, reconstruction, atmosphere, or spatial intuition that would be awkward as SVG. It complements rather than replaces exact charts, maps, diagrams, and sourced media. Use it only when the VISUAL TOOLKIT says an image provider is configured. Set a short, specific \`title\` (3-7 words), a stable \`mediaId\` (kebab slug), a vivid self-contained \`prompt\` describing subject, composition, viewpoint, and teaching focus, plus one-line \`purpose\` and \`alt\`. Avoid important text inside the image and never rely on it for exact labels, measurements, or factual evidence. A job generates and caches the image; you NEVER write a URL.`,
    schema: {
      mediaId: z.string().optional().describe("for `generated-image` blocks ONLY: a kebab-case slug unique within this lesson"),
      prompt: z.string().optional().describe("for `generated-image` blocks ONLY: a vivid self-contained generation prompt"),
      purpose: z.string().optional().describe("for `generated-image` blocks ONLY: the teaching job this illustration performs"),
      alt: altField,
    },
  },
};

/** BlockSchemaFragments for buildLessonSchema — the registry's additive visual kinds
 *  (timeline, spectrum, …). chart/diagram/widget already live in the base schema. */
export function visualSchemaFragments(): { kinds: VisualKind[]; shape: z.ZodRawShape }[] {
  return Object.values(visualAuthoring).map((d) => ({ kinds: [d.kind], shape: d.schema }));
}

/** Assemble the FORMAT-section guidance bullets for the registry's additive visual
 *  kinds. (The domain-aware budget §3a is layered on separately at prompt time.) */
export function assembleVisualGuidance(): string {
  return Object.values(visualAuthoring)
    .map((d) => d.guidance)
    .join("\n");
}
