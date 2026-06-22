// Visual completeness pass (Visual Learning System §3b) — GATED, default OFF. After a
// lesson is persisted, optionally check whether its visual coverage fits its domain; if a
// visual-friendly lesson came back as a wall of prose, APPEND 1–2 visual blocks (a visual
// recap). APPEND-ONLY: it never splices into the middle of lesson.blocks (that would race
// in-flight jobs, highlights, and stable positions). Gated on spike #5 (the domain budget
// §3a may already suffice) behind a settings flag — we don't carry an unproven second pass.
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModelFor } from "../ai/service";
import { lessonRepo, type ConceptRow } from "../store/repositories";
import { queryClient } from "../store/queryClient";
import { inferDomain, kindsForDomains } from "../visuals/catalog";
import { isCompletenessPassEnabled } from "../settings";
import type { Block } from "../types";
import type { LessonContext } from "./lessonPrompt";
import type { FinalizedLesson } from "./finalization";
import { dlog } from "../debug";

const VisualBlockSchema = z.object({
  kind: z.enum(["timeline", "spectrum", "figure", "graph", "map", "chart", "diagram"]),
  title: z.string().optional(),
  alt: z.string().optional(),
  events: z.array(z.object({ at: z.string(), label: z.string(), detail: z.string().optional() })).optional(),
  axis: z.object({ min: z.number(), max: z.number(), labels: z.array(z.string()).optional() }).optional(),
  items: z.array(z.object({ label: z.string(), at: z.number() })).optional(),
  figure: z.object({ svg: z.string().optional() }).optional(),
  labels: z.array(z.object({ text: z.string(), at: z.object({ x: z.number(), y: z.number() }) })).optional(),
  nodes: z.array(z.object({ id: z.string(), label: z.string().optional(), group: z.string().optional() })).optional(),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })).optional(),
  chartType: z.enum(["line", "bar", "scatter", "area"]).optional(),
  series: z
    .array(z.object({ name: z.string().optional(), points: z.array(z.object({ x: z.string(), y: z.number() })) }))
    .optional(),
  text: z.string().optional(),
});
const CompletenessSchema = z.object({
  blocks: z.array(VisualBlockSchema).describe("0-2 visual blocks to append as a visual recap; empty if none genuinely helps"),
});

const APPENDABLE = new Set<string>(["timeline", "spectrum", "figure", "graph", "map", "chart", "diagram"]);

/** Append-only visual completeness pass. No-op unless the flag is on. */
export async function runCompletenessPass(concept: ConceptRow, ctx: LessonContext, lesson: FinalizedLesson): Promise<void> {
  if (!isCompletenessPassEnabled()) return;
  try {
    const blocks = lesson.blocks as Block[];
    const domains = concept.domains?.length
      ? concept.domains
      : [inferDomain(`${ctx.topicTitle} ${concept.title}`)];
    const affinityKinds = kindsForDomains(domains)
      .map((d) => d.id)
      .filter((k) => APPENDABLE.has(k));
    const visualCount = blocks.filter((b) => APPENDABLE.has(b.kind) || b.kind === "widget" || b.kind === "media").length;
    // The budget (§3a) is the primary lever; only step in when coverage is genuinely thin
    // for a visual-friendly domain.
    if (affinityKinds.length === 0 || visualCount >= 1) return;

    const prose = blocks
      .map((b) => [b.label, b.title, b.text].filter(Boolean).join(": "))
      .filter(Boolean)
      .join("\n");
    const { output } = await generateText({
      model: getModelFor("director"),
      output: Output.object({ schema: CompletenessSchema }),
      prompt: `This ${domains.join(" / ")} lesson came back with no visuals. If — and ONLY if — one would genuinely aid understanding, propose 1-2 visual blocks to APPEND as a visual recap. Allowed kinds for this domain: ${affinityKinds.join(", ")}. Emit complete block data (a timeline needs \`events\`; a spectrum needs \`axis\`+\`items\`; a graph needs \`nodes\`+\`edges\`; always set \`alt\`). If nothing genuinely helps, return an empty array — do NOT force a decorative visual.

Lesson:
${prose}`,
    });

    const additions = (output.blocks as unknown as Block[]).filter((b) => b && APPENDABLE.has(b.kind));
    if (additions.length === 0) return;
    const merged = [...blocks, ...additions];
    await lessonRepo.update(concept.id, { blocks: merged });
    queryClient.setQueryData(["lesson", concept.id], (prev: unknown) =>
      prev ? { ...(prev as object), blocks: merged } : prev,
    );
    dlog("director", "appended", additions.length, "visual block(s) to", concept.id);
  } catch (err) {
    dlog("director", "completeness pass failed:", err instanceof Error ? err.message : String(err));
  }
}
