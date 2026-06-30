// GenerationService — topic intake. Before outlining a topic into a tree, the AI
// runs a short multiple-choice interview to refine the goal, depth, scope, and
// starting point. Questions arrive in "waves": a batch of mutually-independent
// questions the UI shows one at a time; dependent follow-ups come in the next
// wave after the first is answered. Capped at MAX_WAVES so round-trips stay bounded.
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModelFor } from "../ai/service";
import type { IntakeAnswer, IntakeQuestion } from "../types";

/** Either the next batch of questions to ask, or the AI's final understanding. */
export type IntakeWave =
  | { done: false; questions: IntakeQuestion[] }
  | { done: true; summary: string };

const WaveSchema = z.object({
  done: z.boolean().describe("true when you have enough to tailor the learning tree"),
  questions: z
    .array(
      z.object({
        prompt: z.string().describe("a single clear question"),
        options: z.array(z.string()).describe("3-5 concise, distinct choices"),
      }),
    )
    .describe("mutually-independent questions to ask now; empty when done"),
  summary: z
    .string()
    .optional()
    .describe("when done: 2-4 sentences describing the tree you'll build"),
});

/** At most this many question batches before we force completion. */
export const MAX_WAVES = 2;

/** Render the answered history as prompt grounding (and reuse it elsewhere). */
export function formatHistory(history: IntakeAnswer[]): string {
  if (history.length === 0) return "none yet";
  return history
    .map((a) => {
      const ans = [a.selected, a.other && `also: ${a.other}`].filter(Boolean).join(" — ");
      return `Q: ${a.prompt}\nA: ${ans || "(skipped)"}`;
    })
    .join("\n\n");
}

/** Fallback summary built from the answers when the model didn't supply one. */
function synthesize(history: IntakeAnswer[]): string {
  if (history.length === 0) return "A focused introductory tree on this topic.";
  const bits = history
    .map((a) => [a.selected, a.other].filter(Boolean).join(" / "))
    .filter(Boolean);
  return `Building a tree tailored to: ${bits.join("; ")}.`;
}

/** Sanitize the model's raw wave: trim/drop empty options, drop under-specified
 *  questions, and resolve to a terminal `done` wave when appropriate. */
function normalize(
  raw: z.infer<typeof WaveSchema>,
  history: IntakeAnswer[],
  forceDone: boolean,
): IntakeWave {
  const questions: IntakeQuestion[] = (raw.questions ?? [])
    .map((q) => ({
      prompt: q.prompt?.trim() ?? "",
      options: (q.options ?? []).map((o) => o.trim()).filter(Boolean),
    }))
    .filter((q) => q.prompt.length > 0 && q.options.length >= 2);

  if (forceDone || raw.done || questions.length === 0) {
    return { done: true, summary: raw.summary?.trim() || synthesize(history) };
  }
  return { done: false, questions };
}

/** Plan the next wave of intake questions for `title`, given prior answers.
 *  `waveIndex` is 0-based; at the last allowed wave we force a terminal result. */
export async function planWave(
  title: string,
  history: IntakeAnswer[],
  waveIndex: number,
): Promise<IntakeWave> {
  const { output } = await generateText({
    model: getModelFor("intake"),
    output: Output.object({ schema: WaveSchema }),
    prompt: `You are interviewing a learner before building their learning tree on "${title}".

Prior answers:
${formatHistory(history)}

Ask the next batch of multiple-choice questions that will let you tailor the tree's goal,
depth, scope, and starting point. Put only MUTUALLY INDEPENDENT questions in this batch
(questions whose wording does not depend on another answer). Save any follow-up that needs a
prior answer for the next batch. Give each question 3-5 short, distinct options. Ask at most
~5 questions total across at most ${MAX_WAVES} batches. When you have enough, set done=true and
write a 2-4 sentence summary of the tree you'll build. No markdown.`,
  });
  return normalize(output, history, waveIndex >= MAX_WAVES - 1);
}
