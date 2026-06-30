import { generateText, Output } from "ai";
import { z } from "zod";
import { getModelFor } from "../ai/service";
import { dlog } from "../debug";
import { mediaProviderRegistry } from "../media/registry";
import { isGenerative } from "../media/types";
import type { ConceptRow } from "../store/repositories";
import { inferDomain, kindsForDomains, visualCatalog, type Domain } from "../visuals/catalog";
import type { LessonContext } from "./lessonPrompt";

export const VISUAL_TOOL_IDS = [
  "chart",
  "diagram",
  "figure",
  "generated-image",
  "graph",
  "map",
  "media",
  "spectrum",
  "table",
  "timeline",
  "widget",
] as const;
export type VisualToolId = (typeof VISUAL_TOOL_IDS)[number];

const VisualToolSchema = z.enum(VISUAL_TOOL_IDS);

const VisualMomentSchema = z.object({
  id: z.string().describe("short kebab-case id for this visual learning moment"),
  label: z.string().describe("short human label for the moment"),
  learningGoal: z.string().describe("what the learner needs to see or manipulate to understand the idea"),
  suggestedTools: z
    .array(VisualToolSchema)
    .min(1)
    .describe("candidate visual tools; suggestions only, not a whitelist"),
  placement: z
    .string()
    .describe("where this should appear in the lesson, e.g. opening, before-formalism, mechanism, comparison, worked-example, recap"),
  required: z
    .boolean()
    .describe("true when prose, code, and equations alone would make this lesson feel insufficiently visual"),
  whyVisual: z.string().describe("why a visual representation teaches this better than prose alone"),
});

export const VisualBriefSchema = z.object({
  visualStance: z
    .string()
    .describe("1-2 sentences describing the visual teaching strategy for this specific lesson"),
  musts: z
    .array(z.string())
    .max(5)
    .describe("visual learning requirements stated as teaching outcomes, not tool restrictions"),
  moments: z
    .array(VisualMomentSchema)
    .max(6)
    .describe("the visual learning moments the lesson writer should build around"),
  successCriteria: z
    .array(z.string())
    .max(6)
    .describe("how to tell whether the generated lesson stayed hyper-visual"),
});

export type VisualBrief = z.infer<typeof VisualBriefSchema>;

const TOOL_DESCRIPTIONS: Record<VisualToolId, string> = {
  chart: "quantitative comparisons, trends, curves, parameter/computation shapes",
  diagram: "Mermaid process flows, pipelines, side-by-side structures, sequences, state changes",
  figure: "labeled schematic SVGs for parts, shapes, architecture, tensor layouts, physical or conceptual structure",
  "generated-image": "rich generated illustrations for scenes, reconstructions, visual analogies, and spatial intuition—not exact evidence or data",
  graph: "node-link relationships, dependencies, influence webs, taxonomies",
  map: "spatial layouts, geographic or conceptual territories, routes, layered progress across places or spaces",
  media: "provider-sourced real images when authenticity teaches better than a schematic",
  spectrum: "continuums, gradients, trade-off axes, positions between poles",
  table: "compact side-by-side comparison or structured facts",
  timeline: "chronology, evolution, historical sequence, staged development",
  widget: "interactive manipulation: sliders, toggles, step-throughs, simulations, live comparisons",
};

function domainsFor(concept: Pick<ConceptRow, "domains" | "title">, ctx: LessonContext): Domain[] {
  return concept.domains?.length ? concept.domains : [inferDomain(`${ctx.topicTitle} ${concept.title}`)];
}

export function visualToolkitPrompt(domains: Domain[]): string {
  const hints = kindsForDomains(domains).map((d) => d.id);
  const hintLine = hints.length
    ? `Catalog hints from this concept's current domains (${domains.join(" / ")}): ${hints.join(", ")}. Treat these as hints only; they are not a whitelist.`
    : `This concept has no strong domain hint. Use the full toolkit based on the lesson's teaching needs.`;
  const tools = VISUAL_TOOL_IDS.map((id) => `- ${id}: ${TOOL_DESCRIPTIONS[id]}`).join("\n");
  const catalogLabels = Object.values(visualCatalog)
    .map((d) => `${d.id} (${d.production})`)
    .join(", ");
  const imageProviders = mediaProviderRegistry.enabled().filter(isGenerative).map((p) => p.label);
  const generatedImageLine = imageProviders.length
    ? `Generated illustrations are available through: ${imageProviders.join(", ")}. Use them when visual richness helps, while keeping exact facts in prose/data/diagrams.`
    : `Generated illustrations are not configured. Do not emit generated-image blocks; choose another visual tool.`;

  return `VISUAL TOOLKIT:
${hintLine}
Available visual tools:
${tools}
${generatedImageLine}
Renderer catalog: ${catalogLabels}.`;
}

function formatConceptList(label: string, values: string[]): string {
  return values.length ? `${label}: ${values.join(", ")}` : `${label}: none listed`;
}

export async function planVisualBrief(
  concept: ConceptRow,
  ctx: LessonContext,
  signal?: AbortSignal,
): Promise<VisualBrief | null> {
  const domains = domainsFor(concept, ctx);
  try {
    const { output } = await generateText({
      model: getModelFor("director"),
      output: Output.object({ schema: VisualBriefSchema }),
      abortSignal: signal,
      prompt: `You are Ascent's visual director. Ascent is a hyper-visual learning environment: the lesson should be planned around what the learner can see, compare, manipulate, or trace.

Your job is to create a visual teaching brief for ONE upcoming lesson. Use the full visual toolkit. The concept's domains are hints, not restrictions. Choose any visual tool when it serves the lesson, including unusual choices. Do not pre-ban any visual tool.

${visualToolkitPrompt(domains)}

Topic: "${ctx.topicTitle}"
Path: ${ctx.path.join(" > ")}
Concept: "${concept.title}"
Focus: ${ctx.summary || concept.summary || "not provided"}
Learner brief: ${ctx.briefSummary || "not provided"}
${formatConceptList("Sibling concepts taught separately", ctx.siblings)}
${formatConceptList("Child concepts taught separately", ctx.children)}

Return a visual brief:
- visualStance: how this lesson should teach visually.
- musts: requirements stated as learning outcomes, not tool bans.
- moments: visual learning moments the lesson writer should build around. Mark required=true when prose/code/equations alone would fail Ascent's standard.
- suggestedTools: candidate tools only. The writer may substitute any supported tool if it better teaches the same learning goal.
- successCriteria: how an audit should know the lesson remained visual-first.

Prefer 2-4 strong visual moments over a long decorative list. No markdown.`,
    });
    return output;
  } catch (err) {
    if (signal?.aborted) throw err;
    dlog("director", "visual brief failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export function renderVisualBriefForPrompt(brief: VisualBrief | null): string {
  if (!brief) {
    return `VISUAL TEACHING CONTRACT:
- Before writing a mechanism-heavy explanation, decide what the learner should see, compare, trace, or manipulate.
- Use any supported visual tool that teaches the current concept well; domain hints are not limits.
- Equations and code are supporting artifacts when a visual model would make the mechanism clearer.`;
  }

  const musts = brief.musts.length ? brief.musts.map((m) => `- ${m}`).join("\n") : "- Choose visuals based on the lesson's actual teaching needs.";
  const moments = brief.moments.length
    ? brief.moments
        .map(
          (m) =>
            `- [${m.id}] ${m.label}${m.required ? " (required)" : ""}: ${m.learningGoal}\n  Suggested tools: ${m.suggestedTools.join(", ")}. Placement: ${m.placement}. Why visual: ${m.whyVisual}`,
        )
        .join("\n")
    : "- No specific moment was preselected; still make the lesson visual-first where the concept gives you something to show.";
  const criteria = brief.successCriteria.length ? brief.successCriteria.map((c) => `- ${c}`).join("\n") : "- The lesson contains visual anchors for major mechanisms.";

  return `VISUAL TEACHING CONTRACT:
Visual stance: ${brief.visualStance}

Visual learning musts:
${musts}

Visual moments to build around:
${moments}

Success criteria:
${criteria}

As the lesson writer, preserve the learning goals above. Suggested tools are not a whitelist; choose any supported visual tool that teaches the moment better.`;
}

export function domainsForLesson(concept: Pick<ConceptRow, "domains" | "title">, ctx: LessonContext): Domain[] {
  return domainsFor(concept, ctx);
}
