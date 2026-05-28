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
    .describe(
      "8-14 blocks: short paragraphs (2-4 sentences, one idea each), section headers that chunk the lesson into clear beats, at most one callout",
    ),
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
    prompt: `You are an exceptional tutor — the kind whose explanations make a hard idea
suddenly click — writing ONE focused lesson within a larger learning tree. Your goal is
understanding, not coverage. Do NOT write like an encyclopedia.

Topic: "${ctx.topicTitle}"
Path: ${ctx.path.join(" > ")}
Concept to teach: "${concept.title}"${focus}${siblings}${children}

HOW TO EXPLAIN (this matters more than how much you cover):
- Start from intuition. Before any formalism, give the learner a way to picture or feel
  what's going on and why it matters — a plain-language framing, an analogy, or a motivating
  question. Earn the formal definition; don't open with it.
- Build up in small steps, one idea per paragraph. Introduce a piece, make it land, then add
  the next. Never stack three new ideas into one dense paragraph.
- Show, don't just state. Include at least one concrete worked example — small real numbers,
  a tiny scenario, or a case walked through step by step — and use everyday analogies where
  they genuinely help. The moment you introduce notation or a formula, say in words what each
  part means and why it's there.
- Keep the rigor. This is NOT "explain like I'm five": stay precise and correct, name things
  properly — just make the path to understanding gentle, and unpack jargon the instant you use it.
- Be warm and direct, like you're talking to one curious person. No filler, no throat-clearing,
  no "in this lesson we will".

FORMAT:
- 8-14 blocks, mostly short "paragraph" blocks of 2-4 sentences (break up anything longer).
- Use "section" headers to chunk the lesson into a few clear beats — e.g. the intuition, the
  mechanism, a worked example, why it matters. Give each a short label and optional one-line hint.
- Across the paragraphs, mark 2-5 key TERMS (each appearing verbatim in that paragraph's text)
  with a one-line gloss — these become forkable branches.
- A "callout" is RARE (at most one): reserve it for a single standout intuition or "watch out",
  with a short label ("Intuition", "Notice", "Watch out") and a real sentence of body. Omit it if
  nothing earns it; never label one "load-bearing". Put examples in normal paragraphs, not callouts.
- Every block must have content: paragraph and callout need non-empty text, section needs a label.
- Finish by suggesting 2-4 next concepts. No markdown.`,
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
