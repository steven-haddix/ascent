// GenerationService — lesson bodies. Streamed on first visit and persisted.
// generateLesson streams partial lessons (onPartial) for progressive rendering,
// then persists the complete, validated result.
import { streamText, Output } from "ai";
import { z } from "zod";
import { getModel, MODELS } from "../ai/service";
import { lessonRepo, conceptRepo, type ConceptRow } from "../store/repositories";
import type { Block, SuggestedBranch, LensId } from "../types";

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
          .describe("for paragraphs only: key terms appearing verbatim in `text`, each with a one-line gloss, that a curious learner could branch into"),
      }),
    )
    .describe("6-12 blocks: mostly short paragraphs, optional section headers, maybe one callout"),
  suggestedBranches: z
    .array(z.object({ title: z.string(), reason: z.string() }))
    .describe("2-4 concepts worth exploring next"),
});

export interface LessonContext {
  topicTitle: string;
  path: string[];
  summary?: string | null;
  siblings: string[];
  children: string[];
}

/** A lesson while it's still streaming (fields fill in progressively). */
export interface PartialLesson {
  subtitle?: string;
  blocks?: Block[];
  suggestedBranches?: SuggestedBranch[];
}

export async function generateLesson(
  concept: ConceptRow,
  ctx: LessonContext,
  onPartial?: (partial: PartialLesson) => void,
) {
  const focus = ctx.summary ? `\nFocus (what this concept should cover): ${ctx.summary}` : "";
  const siblings = ctx.siblings.length
    ? `\nSibling concepts taught separately — do NOT re-explain these: ${ctx.siblings.join(", ")}.`
    : "";
  const children = ctx.children.length
    ? `\nThis concept has sub-concepts taught in their own lessons: ${ctx.children.join(", ")}. Keep THIS lesson an orienting overview that motivates and connects them — don't fully dive into each.`
    : "";

  const result = streamText({
    model: getModel(MODELS.default),
    output: Output.object({ schema: LessonSchema }),
    prompt: `You are a sharp, concrete tutor writing ONE focused lesson within a larger learning tree.

Topic: "${ctx.topicTitle}"
Path: ${ctx.path.join(" > ")}
Concept to teach: "${concept.title}"${focus}${siblings}${children}

Write a tight lesson of 6-12 blocks, mostly short "paragraph" blocks. Across the
paragraphs, mark 2-5 key TERMS (each appearing verbatim in that paragraph's text) with a
one-line gloss — these become forkable branches. Use "section" headers to structure a
longer lesson. A "callout" is RARE (at most one in the whole lesson): only for a single
standout takeaway — give it a short label such as "Notice", "Intuition", or "Watch out"
AND a real sentence of body text; omit callouts entirely if nothing warrants one (never
label one "load-bearing"). Every block must have content: paragraph and callout need
non-empty text, section needs a label. Finish by suggesting 2-4 next concepts. Be
concrete; no filler; no markdown.`,
  });

  for await (const partial of result.partialOutputStream) {
    onPartial?.(partial as unknown as PartialLesson);
  }
  const output = await result.output;

  const now = Date.now();
  const row = {
    conceptId: concept.id,
    title: concept.title,
    subtitle: output.subtitle,
    blocks: output.blocks as Block[],
    suggestedBranches: output.suggestedBranches as SuggestedBranch[],
    lenses: ["notes", "quiz", "chat", "teach"] as LensId[],
    model: MODELS.default,
    generatedAt: now,
  };
  await lessonRepo.upsert(row);
  await conceptRepo.update(concept.id, {
    state: "ready",
    status: concept.status === "queued" ? "visited" : concept.status,
  });
  return row;
}
