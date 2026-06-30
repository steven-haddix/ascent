// Composable Zod schema for lesson bodies. The default `LessonSchema` is
// byte-identical to the inline schema that used to live in lesson.ts; the
// builder lets later waves (e.g. the visual block registry) contribute extra
// block kinds + fields without rewriting the lesson generator.
import { z } from "zod";
import { visualSchemaFragments } from "../visuals/authoring";

/** The lesson block kinds present today (order preserved). */
export const BASE_BLOCK_KINDS = [
  "paragraph",
  "callout",
  "section",
  "code",
  "table",
  "math",
  "chart",
  "diagram",
  "widget",
] as const;

/** A registry fragment contributing extra block kinds + their optional fields. */
export interface BlockSchemaFragment {
  kinds: readonly string[]; // kind enum values this fragment adds
  shape: z.ZodRawShape; // additional optional fields (merged into the block object)
}

export function buildLessonBlockSchema(fragments: BlockSchemaFragment[] = []) {
  const kinds = [...BASE_BLOCK_KINDS, ...fragments.flatMap((f) => f.kinds)];
  const extraShape: z.ZodRawShape = Object.assign({}, ...fragments.map((f) => f.shape));
  return z.object({
    kind: z.enum(kinds as [string, ...string[]]),
    text: z
      .string()
      .optional()
      .describe("paragraph/callout body, `code` source, LaTeX (no delimiters) for `math`, or Mermaid source for `diagram`"),
    label: z.string().optional().describe("callout label (e.g. 'Notice') or section label"),
    hint: z.string().optional().describe("optional one-line section hint"),
    terms: z
      .array(z.object({ term: z.string(), gloss: z.string() }))
      .optional()
      .describe("for paragraphs only: key terms appearing verbatim in `text`, each with a one-line gloss, that a curious learner could branch into"),
    language: z
      .string()
      .optional()
      .describe("for `code` blocks ONLY: the source language — 'python', 'javascript', 'typescript', 'bash', or 'json'"),
    title: z
      .string()
      .optional()
      .describe("a short, specific label (3-7 words): the title of a `code` snippet, or a caption for a `table` (and later `diagram`/`chart`)"),
    headers: z
      .array(z.string())
      .optional()
      .describe("for `table` blocks ONLY: short column headers"),
    rows: z
      .array(z.array(z.string()))
      .optional()
      .describe("for `table` blocks ONLY: rows, each an array of short cell strings aligned to `headers`"),
    chartType: z
      .enum(["line", "bar", "scatter", "area"])
      .optional()
      .describe("for `chart` blocks ONLY: how to plot the series"),
    series: z
      .array(
        z.object({
          name: z.string().optional().describe("series label (shown in the legend)"),
          points: z
            .array(z.object({ x: z.string(), y: z.number() }))
            .describe('data points; x is a number written as a string (e.g. "0.5") for line/scatter/area, or a short category label for bar; y is a number'),
        }),
      )
      .optional()
      .describe("for `chart` blocks ONLY: one or more data series"),
    xLabel: z.string().optional().describe("for `chart` blocks ONLY: x-axis label"),
    yLabel: z.string().optional().describe("for `chart` blocks ONLY: y-axis label"),
    widgetId: z
      .string()
      .optional()
      .describe("for `widget` blocks ONLY: a short kebab-case slug unique within this lesson, e.g. 'gradient-descent-slider'"),
    spec: z
      .string()
      .optional()
      .describe(
        "for `widget` blocks ONLY: 2-5 sentences specifying the interaction — what it shows, which variables the learner controls (with ranges), what responds and how, and the one insight it should surface. The builder sees ONLY this, so make it self-contained",
      ),
    ...extraShape,
  });
}

const SuggestedLessonSchema = z.object({ handle: z.string(), reason: z.string() });
const SuggestedForkSchema = z.object({ title: z.string(), reason: z.string() });

export function buildLessonSchema(fragments: BlockSchemaFragment[] = []) {
  const block = buildLessonBlockSchema(fragments);
  return z.object({
    subtitle: z.string().describe("one-line subtitle framing the lesson"),
    blocks: z
      .array(block)
      .describe(
        "8-14 blocks: short paragraphs (2-4 sentences, one idea each), section headers that chunk the lesson into clear beats, at most one callout",
      ),
    suggestedLessons: z
      .array(SuggestedLessonSchema)
      .describe("next concepts that ALREADY EXIST in the tree — reference each by its handle (e.g. 'c2'); these become links, never recreate them"),
    suggestedForks: z
      .array(SuggestedForkSchema)
      .describe("genuinely NEW sub-concepts to create, absent from the existing list — these fork a new lesson under this one"),
  });
}

/** The lesson schema: the base block kinds + the visual registry's additive kinds
 *  (timeline/spectrum/…) merged in from visualAuthoring (Visual §2). */
export const LessonSchema = buildLessonSchema(visualSchemaFragments());
export const LessonContinuationSchema = z.object({
  subtitle: z.string().optional().describe("provide only when the interrupted lesson did not establish one"),
  blocks: z
    .array(buildLessonBlockSchema(visualSchemaFragments()))
    .describe("only the new blocks that follow the immutable accepted prefix; never repeat accepted blocks"),
  suggestedLessons: z.array(SuggestedLessonSchema),
  suggestedForks: z.array(SuggestedForkSchema),
});
export type LessonSchemaType = typeof LessonSchema;
