// GenerationService — Feynman teach-back grading. The learner explains a concept
// in their own words; the model returns a structured grade (rubric / verdict /
// annotated spans / gaps). Single structured result (not streamed) — grades must
// be reliable, and the app (not the model) owns the mastery math downstream.
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel } from "../ai/service";
import type { ConceptRow } from "../store/repositories";
import type { RubricScores, TeachAnnotation, TeachGap, TeachAudience } from "../types";

const GradeSchema = z.object({
  rubric: z.object({
    clarity: z.number().min(0).max(1).describe("0..1: how clearly and simply it is explained"),
    accuracy: z.number().min(0).max(1).describe("0..1: factual correctness; penalize misconceptions"),
    completeness: z.number().min(0).max(1).describe("0..1: did it cover the essential ideas of the concept"),
    model: z.number().min(0).max(1).describe("0..1: quality of the mental model — analogies, intuition, connections"),
  }),
  verdict: z
    .string()
    .describe("2-3 sentences addressed to the learner ('you...'), specific, kind but honest"),
  annotations: z
    .array(
      z.object({
        text: z.string().describe("a short EXACT verbatim substring copied from the learner's explanation"),
        kind: z.enum(["strong", "vague", "gap"]),
        note: z.string().describe("one short line on why this span is strong / vague / a gap"),
      }),
    )
    .describe("3-8 spans, each quoted verbatim from the explanation, marking strengths and weaknesses"),
  gaps: z
    .array(z.object({ title: z.string(), reason: z.string() }))
    .describe("0-3 concepts to study next to close the biggest gaps — concept titles + one line each; empty if excellent"),
});

const AUDIENCE_LABEL: Record<TeachAudience, string> = {
  child: "a smart 12-year-old",
  peer: "a knowledgeable peer",
  expert: "a domain expert",
};

// What "good" means per audience. This is what actually recalibrates the rubric —
// the audience is no longer just a label, it changes how clarity/accuracy/
// completeness are judged. Gaps may still point to technical next-steps; the
// audience only governs how the explanation itself is *scored* and worded.
const AUDIENCE_RUBRIC: Record<TeachAudience, string> = {
  child:
    "AUDIENCE — a smart 12-year-old. Grade whether the core IDEA comes across in plain, vivid " +
    "language. Reward intuition, analogy, and a correct mental model. Do NOT require technical " +
    "terms or named components — omitting jargon is correct here, and leaning on it would HURT " +
    "clarity, not help it. Score accuracy and completeness on the idea, not the vocabulary: an " +
    "explanation that conveys the right picture should score well even with zero jargon. Still " +
    "flag genuine conceptual mistakes, phrased simply. You may list technical concepts as gaps " +
    "to explore next, but treat them as optional deeper dives — never imply the explanation " +
    "failed for not using those terms.",
  peer:
    "AUDIENCE — a knowledgeable peer. Expect the core mechanism explained correctly with the key " +
    "concepts named, but a worked intuition counts as much as formal precision. Flag missing core " +
    "ideas or imprecision; gaps may name real concepts.",
  expert:
    "AUDIENCE — a domain expert. Demand precision, correct terminology, and awareness of subtleties " +
    "and edge cases. Penalize hand-waving, vagueness, or hidden misconceptions; reward rigor and " +
    "completeness. Gaps should be specific and technical.",
};

export interface TeachResult {
  rubric: RubricScores;
  verdict: string;
  annotations: TeachAnnotation[];
  gaps: TeachGap[];
}

export interface TeachContext {
  topicTitle: string;
  path: string[];
  summary?: string | null;
}

export async function gradeTeachBack(
  concept: ConceptRow,
  ctx: TeachContext,
  text: string,
  audience: TeachAudience,
): Promise<TeachResult> {
  const who = AUDIENCE_LABEL[audience];
  const focus = ctx.summary ? `\nWhat this concept is about: ${ctx.summary}` : "";
  const { output } = await generateText({
    model: getModel(),
    output: Output.object({ schema: GradeSchema }),
    prompt: `You are a rigorous but encouraging examiner running a Feynman "teach-back".
A learner is studying "${concept.title}" within "${ctx.topicTitle}" (${ctx.path.join(" > ")}).${focus}
They were asked to explain it to ${who}. Here is their explanation:

"""
${text}
"""

${AUDIENCE_RUBRIC[audience]}

Grade it. Score the rubric 0..1 (clarity, accuracy, completeness, mental model) BY THAT
STANDARD. Write a 2-3 sentence verdict addressed to the learner, in language that fits the
audience. Pick 3-8 short spans copied VERBATIM from their explanation (the \`text\` field
MUST be an exact substring of the explanation above) and mark each strong / vague / gap with
a one-line note. List 0-3 gaps as concepts to study next (none if the explanation is
excellent). No markdown.`,
  });
  return output as TeachResult;
}

/** Collapse the rubric into a single 0..1 attempt score. Accuracy and
 *  completeness weigh most; the mental model is a bonus. App policy, not the model's. */
export function scoreFromRubric(r: RubricScores): number {
  return 0.2 * r.clarity + 0.35 * r.accuracy + 0.35 * r.completeness + 0.1 * r.model;
}
