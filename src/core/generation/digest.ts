import { generateText, Output } from "ai";
import { z } from "zod";
import { getModelFor } from "../ai/service";
import type { Block, LessonDigest } from "../types";

const DigestSchema = z.object({
  recap: z.string().describe("1-2 sentences: what the learner knows after this lesson"),
  motifs: z.array(z.string()).describe("analogies / mental models this lesson used (e.g. 'loss surface as terrain'); empty if none"),
  notation: z.array(z.object({ symbol: z.string(), means: z.string() })).describe("symbols/terms this lesson pinned down; empty for non-technical lessons"),
  openLoops: z.array(z.string()).describe("questions this lesson raised but deliberately did NOT answer"),
  deferredTo: z.array(z.string()).describe("sub-topics this lesson explicitly leaves to deeper lessons"),
  assumedPrereqs: z.array(z.string()).describe("concepts (by title) this lesson assumed/built on"),
});

/** Flatten a lesson's blocks to plain text for the digest prompt. */
function blocksToProse(blocks: Block[]): string {
  return blocks
    .map((b) => [b.label, b.title, b.text].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("\n\n");
}

/** Produce a compact structured digest of a just-generated lesson (continuity B2).
 *  A cheap post-stream call (the `digest` task) — OFF the render critical path. */
export async function generateDigest(lesson: { title: string; subtitle?: string | null; blocks: Block[] }): Promise<LessonDigest> {
  const prose = blocksToProse(lesson.blocks);
  const { output } = await generateText({
    model: getModelFor("digest"),
    output: Output.object({ schema: DigestSchema }),
    prompt: `Summarize what this lesson ESTABLISHED, for a memory that later lessons read so they can build on it (not re-explain it). Be terse and concrete.

Lesson: "${lesson.title}"${lesson.subtitle ? ` — ${lesson.subtitle}` : ""}

${prose}

Return:
- recap: 1-2 sentences on what the learner now knows.
- motifs: analogies / mental models this lesson leaned on (empty if none).
- notation: symbols/terms it pinned down, each {symbol, means} (empty for non-technical).
- openLoops: questions it raised but deliberately left unanswered.
- deferredTo: sub-topics it explicitly left to deeper lessons.
- assumedPrereqs: concepts (by title) it assumed the learner already knew.
No markdown.`,
  });
  return output;
}

export { DigestSchema };
