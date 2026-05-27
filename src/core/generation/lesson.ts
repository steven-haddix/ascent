// GenerationService — lesson bodies. Generated lazily on first visit and
// persisted. Non-streaming for now (reuses the proven ai_request transport);
// M3-B switches this to streamObject over the Rust Channel for progressive
// rendering. The UI renders from persisted blocks either way.
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel, MODELS } from "../ai/service";
import { lessonRepo, conceptRepo, type ConceptRow } from "../store/repositories";
import type { Block, SuggestedBranch } from "../types";

const LessonSchema = z.object({
  subtitle: z.string().describe("one-line subtitle framing the lesson"),
  blocks: z
    .array(
      z.object({
        kind: z.enum(["paragraph", "callout", "section"]),
        text: z.string().optional().describe("paragraph body, or callout body"),
        label: z.string().optional().describe("callout label (e.g. 'Notice') or section label"),
        hint: z.string().optional().describe("optional one-line section hint"),
        terms: z
          .array(z.object({ term: z.string(), gloss: z.string() }))
          .optional()
          .describe("for paragraphs only: key terms that appear verbatim in `text`, each with a one-line gloss, that a curious learner could branch into"),
      }),
    )
    .describe("6-12 blocks: mostly short paragraphs, optional section headers, maybe one callout"),
  suggestedBranches: z
    .array(z.object({ title: z.string(), reason: z.string() }))
    .describe("2-4 concepts worth exploring next"),
});

export interface LessonContext {
  path: string[];
  topicTitle: string;
}

export async function generateLesson(concept: ConceptRow, ctx: LessonContext) {
  const { output } = await generateText({
    model: getModel(MODELS.default),
    output: Output.object({ schema: LessonSchema }),
    prompt: `You are a sharp, concrete tutor writing ONE focused lesson.

Topic: "${ctx.topicTitle}"
Path: ${ctx.path.join(" > ")}
Concept to teach: "${concept.title}"

Write a tight lesson of 6-12 blocks. Use short paragraphs. Across the paragraphs,
mark 2-5 key TERMS (each appearing verbatim in that paragraph's text) with a one-line
gloss — these become forkable branches. Optionally include one "callout" (label + text)
for a load-bearing insight, and "section" headers to structure a longer lesson. Finish
by suggesting 2-4 next concepts. Be concrete; no filler; no markdown.`,
  });

  const now = Date.now();
  await lessonRepo.upsert({
    conceptId: concept.id,
    title: concept.title,
    subtitle: output.subtitle,
    blocks: output.blocks as Block[],
    suggestedBranches: output.suggestedBranches as SuggestedBranch[],
    lenses: ["notes", "quiz", "chat"],
    model: MODELS.default,
    generatedAt: now,
  });
  await conceptRepo.update(concept.id, {
    state: "ready",
    status: concept.status === "queued" ? "visited" : concept.status,
  });

  return output;
}
