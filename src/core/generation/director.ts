// Visual audit/repair pass. This is deliberately not deterministic routing: the
// director model evaluates the generated lesson and decides whether its own
// mechanisms, structures, comparisons, or transformations need stronger visual
// support. The pass is append-only until lesson blocks have stable ids.
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModelFor } from "../ai/service";
import { dlog } from "../debug";
import { isVisualAuditEnabled } from "../settings";
import { queryClient } from "../store/queryClient";
import { lessonRepo, type ConceptRow } from "../store/repositories";
import type { Block, LensId } from "../types";
import { scanForGeneratedImageJobs } from "./generatedImageJobs";
import { scanForMediaJobs } from "./mediaJobs";
import { scanForWidgetJobs } from "./widgetJobs";
import type { FinalizedLesson } from "./finalization";
import type { LessonContext } from "./lessonPrompt";
import { domainsForLesson, visualToolkitPrompt } from "./visualPlan";

const RepairBlockSchema = z.object({
  kind: z.enum([
    "section",
    "paragraph",
    "table",
    "chart",
    "diagram",
    "widget",
    "timeline",
    "spectrum",
    "figure",
    "graph",
    "map",
    "media",
    "generated-image",
  ]),
  text: z.string().optional(),
  label: z.string().optional(),
  hint: z.string().optional(),
  title: z.string().optional(),
  headers: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())).optional(),
  chartType: z.enum(["line", "bar", "scatter", "area"]).optional(),
  series: z
    .array(z.object({ name: z.string().optional(), points: z.array(z.object({ x: z.string(), y: z.number() })) }))
    .optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  widgetId: z.string().optional(),
  spec: z.string().optional(),
  alt: z.string().optional(),
  events: z.array(z.object({ at: z.string(), label: z.string(), detail: z.string().optional() })).optional(),
  lanes: z.array(z.string()).optional(),
  axis: z.object({ min: z.number(), max: z.number(), labels: z.array(z.string()).optional() }).optional(),
  items: z.array(z.object({ label: z.string(), at: z.number() })).optional(),
  figure: z.object({ svg: z.string().optional(), mediaId: z.string().optional() }).optional(),
  labels: z.array(z.object({ text: z.string(), at: z.object({ x: z.number(), y: z.number() }) })).optional(),
  nodes: z.array(z.object({ id: z.string(), label: z.string().optional(), group: z.string().optional() })).optional(),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })).optional(),
  projection: z.enum(["world", "mercator", "albersUsa"]).optional(),
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
    .optional(),
  mediaId: z.string().optional(),
  query: z.string().optional(),
  prompt: z.string().optional(),
  purpose: z.string().optional(),
});

const VisualAuditSchema = z.object({
  verdict: z.enum(["strong", "thin", "missing", "misaligned"]),
  rationale: z.string().describe("brief reason for the verdict"),
  blocks: z
    .array(RepairBlockSchema)
    .max(4)
    .describe("0-4 compact blocks to append as a visual repair/recap cluster; empty when the lesson is already strong"),
});

const VISUAL_ANCHOR_KINDS = new Set<Block["kind"]>([
  "table",
  "chart",
  "diagram",
  "widget",
  "timeline",
  "spectrum",
  "figure",
  "graph",
  "map",
  "media",
  "generated-image",
]);

const VIZ_LENS_KINDS = new Set<Block["kind"]>([
  "chart",
  "diagram",
  "timeline",
  "spectrum",
  "figure",
  "graph",
  "map",
  "media",
  "generated-image",
]);

function blockSummary(blocks: Block[]): string {
  return blocks
    .map((b, i) => {
      const parts = [b.label, b.title, b.text].filter(Boolean).join(": ");
      const visualData =
        b.kind === "chart"
          ? ` series=${b.series?.length ?? 0}`
          : b.kind === "graph"
            ? ` nodes=${b.nodes?.length ?? 0} edges=${b.edges?.length ?? 0}`
            : b.kind === "diagram"
              ? ` mermaid=${b.text?.slice(0, 140) ?? ""}`
              : b.kind === "figure"
                ? ` labels=${b.labels?.length ?? 0} alt=${b.alt ?? ""}`
                : b.kind === "widget"
                  ? ` spec=${b.spec ?? ""}`
                  : b.kind === "media"
                    ? ` query=${b.query ?? ""}`
                    : b.kind === "generated-image"
                      ? ` prompt=${b.prompt ?? ""}`
                      : "";
      return `${i + 1}. ${b.kind}${parts ? ` — ${parts.slice(0, 650)}` : ""}${visualData}`;
    })
    .join("\n");
}

function isUsableRepairBlock(b: Block): boolean {
  switch (b.kind) {
    case "section":
      return !!b.label?.trim();
    case "paragraph":
      return !!b.text?.trim();
    case "table":
      return !!(b.headers?.length || b.rows?.length);
    case "chart":
      return !!b.series?.length;
    case "diagram":
      return !!b.text?.trim();
    case "widget":
      return !!(b.title?.trim() && b.spec?.trim());
    case "timeline":
      return !!b.events?.length;
    case "spectrum":
      return !!(b.axis && b.items?.length);
    case "figure":
      return !!(b.figure?.svg || b.figure?.mediaId);
    case "graph":
      return !!(b.nodes?.length && b.edges?.length);
    case "map":
      return !!b.marks?.length;
    case "media":
      return !!(b.mediaId?.trim() && b.query?.trim());
    case "generated-image":
      return !!(b.mediaId?.trim() && b.prompt?.trim() && (b.alt?.trim() || b.purpose?.trim()));
    default:
      return false;
  }
}

function isVisualAnchor(b: Block): boolean {
  return VISUAL_ANCHOR_KINDS.has(b.kind) && isUsableRepairBlock(b);
}

function updateLenses(existing: LensId[], additions: Block[]): LensId[] {
  const out = new Set(existing);
  if (additions.some((b) => VIZ_LENS_KINDS.has(b.kind))) out.add("viz");
  return Array.from(out);
}

/** Append-only visual audit. The model may choose any supported visual tool; this
 *  code only enforces shape/renderability and updates jobs/lenses after appending. */
export async function runVisualAuditPass(
  concept: ConceptRow,
  ctx: LessonContext,
  lesson: FinalizedLesson,
): Promise<void> {
  if (!isVisualAuditEnabled()) return;
  try {
    const blocks = lesson.blocks as Block[];
    const domains = domainsForLesson(concept, ctx);
    const existingVisuals = blocks.filter((b) => VISUAL_ANCHOR_KINDS.has(b.kind)).map((b) => b.kind);

    const { output } = await generateText({
      model: getModelFor("director"),
      output: Output.object({ schema: VisualAuditSchema }),
      prompt: `You are Ascent's visual audit pass. Ascent should feel like hyper-visual learning, not a differently organized article.

Judge the generated lesson by visual teaching quality, not visual count. Ask whether the learner can see, compare, trace, or manipulate the important mechanisms, structures, transformations, routes, states, or trade-offs. Existing visuals may be strong, weak, or off-target.

You can append only, so if repair is needed, create a compact end-of-lesson visual recap cluster that stands on its own. Use any supported visual tool that teaches best; domain hints are not restrictions.

${visualToolkitPrompt(domains)}

Topic: "${ctx.topicTitle}"
Path: ${ctx.path.join(" > ")}
Concept: "${concept.title}"
Focus: ${ctx.summary || concept.summary || "not provided"}
Existing visual/structured block kinds: ${existingVisuals.length ? existingVisuals.join(", ") : "none"}

Generated lesson blocks:
${blockSummary(blocks)}

Return:
- verdict "strong" when the lesson already has meaningful visual anchors for its important ideas.
- verdict "thin" when visuals exist but miss key mechanisms or are mostly peripheral.
- verdict "missing" when the lesson is prose/code/equation heavy and visually under-teaches.
- verdict "misaligned" when the visuals are present but teach the wrong thing.
- blocks: empty for strong lessons; otherwise append 1 compact visual repair cluster, usually a section plus 1-2 visual/structured blocks plus at most one short paragraph. Every visual addition needs a specific teaching job and complete renderable fields. No markdown.`,
    });

    const additions = (output.blocks as unknown as Block[]).filter(isUsableRepairBlock);
    if (additions.length === 0 || !additions.some(isVisualAnchor)) {
      dlog("director", "visual audit:", output.verdict, "—", output.rationale);
      return;
    }

    const merged = [...blocks, ...additions];
    const lenses = updateLenses(lesson.lenses as LensId[], additions);
    await lessonRepo.update(concept.id, { blocks: merged, lenses });
    queryClient.setQueryData(["lesson", concept.id], (prev: unknown) =>
      prev ? { ...(prev as object), blocks: merged, lenses } : prev,
    );

    lesson.blocks = merged;
    lesson.lenses = lenses;

    scanForWidgetJobs(concept, { topicTitle: ctx.topicTitle, path: ctx.path }, merged, true);
    scanForMediaJobs(concept.id, merged);
    scanForGeneratedImageJobs(concept.id, merged);
    dlog("director", "visual audit appended", additions.length, "block(s):", output.verdict, "—", output.rationale);
  } catch (err) {
    dlog("director", "visual audit failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Back-compat name for older imports/tests; the behavior is now a quality audit,
 *  not the old zero-visual completeness gate. */
export const runCompletenessPass = runVisualAuditPass;
