// GenerationService — quick-check quizzes. Generated on demand for a concept;
// held in the query cache (not persisted) so it survives tab switches within a
// session and can be regenerated for a fresh set.
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel } from "../ai/service";
import type { ConceptRow } from "../store/repositories";

const QuizSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        choices: z.array(z.string()).describe("3-4 plausible options"),
        answerIndex: z.number().int().describe("0-based index of the correct choice"),
        explanation: z.string().describe("one line on why the answer is right"),
      }),
    )
    .describe("2-4 multiple-choice questions that test understanding, not trivia"),
});

export type QuizQuestion = z.infer<typeof QuizSchema>["questions"][number];

export async function generateQuiz(concept: ConceptRow, topicTitle: string): Promise<QuizQuestion[]> {
  const { output } = await generateText({
    model: getModel(),
    output: Output.object({ schema: QuizSchema }),
    prompt: `Write a 2-4 question multiple-choice quick-check on "${concept.title}" (within "${topicTitle}").
Each question has 3-4 choices; set answerIndex to the correct one (0-based); add a one-line
explanation. Test understanding and intuition, not trivia. No markdown.`,
  });
  return output.questions;
}
