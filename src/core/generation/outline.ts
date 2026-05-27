// GenerationService — topic outlining. Generates a concept-tree skeleton up
// front (fast, navigable); lesson bodies generate lazily on visit in M3.
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel, MODELS } from "../ai/service";
import { topicRepo, conceptRepo } from "../store/repositories";

const OutlineSchema = z.object({
  concepts: z
    .array(
      z.object({
        title: z.string().describe("short concept name, 2-5 words"),
        rationale: z.string().describe("one line on what it covers / why it matters"),
        children: z
          .array(z.object({ title: z.string(), rationale: z.string() }))
          .optional()
          .describe("2-4 sub-concepts, optional"),
      }),
    )
    .describe("4-7 top-level concepts, ordered foundational -> advanced"),
});

export type OutlineConcept = z.infer<typeof OutlineSchema>["concepts"][number];

export async function outlineTopic(title: string): Promise<OutlineConcept[]> {
  const { output } = await generateText({
    model: getModel(MODELS.default),
    output: Output.object({ schema: OutlineSchema }),
    prompt: `You are mapping a subject into a learning tree for a curious learner.

Topic: "${title}"

Produce 4-7 top-level concepts forming a coherent path from foundations to depth.
For each, optionally include 2-4 sub-concepts that break it down. Keep titles short
(2-5 words). Give a one-line rationale per concept. Order foundational -> advanced.`,
  });
  return output.concepts;
}

/** Generate a topic's outline and persist it as a concept tree.
 *  Returns the new topic id and the root concept to open first. */
export async function startTopic(
  title: string,
): Promise<{ topicId: string; rootConceptId: string }> {
  const outline = await outlineTopic(title);
  const now = Date.now();
  const topicId = crypto.randomUUID();
  const rootId = crypto.randomUUID();

  await topicRepo.create({ id: topicId, title, rootConceptId: rootId, createdAt: now });
  await conceptRepo.create({
    id: rootId,
    topicId,
    parentId: null,
    title,
    status: "current",
    state: "outline",
    order: 0,
    mastery: 0,
    remedial: false,
    createdAt: now,
  });

  let order = 0;
  for (const concept of outline) {
    const cid = crypto.randomUUID();
    await conceptRepo.create({
      id: cid,
      topicId,
      parentId: rootId,
      title: concept.title,
      summary: concept.rationale,
      status: "queued",
      state: "outline",
      order: order++,
      mastery: 0,
      remedial: false,
      createdAt: now,
    });
    let childOrder = 0;
    for (const child of concept.children ?? []) {
      await conceptRepo.create({
        id: crypto.randomUUID(),
        topicId,
        parentId: cid,
        title: child.title,
        summary: child.rationale,
        status: "queued",
        state: "outline",
        order: childOrder++,
        mastery: 0,
        remedial: false,
        createdAt: now,
      });
    }
  }
  return { topicId, rootConceptId: rootId };
}
