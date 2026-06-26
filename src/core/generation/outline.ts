// GenerationService — topic outlining. Generates a concept-tree skeleton up
// front (fast, navigable); lesson bodies generate lazily on visit in M3.
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel } from "../ai/service";
import { topicRepo, conceptRepo } from "../store/repositories";
import { formatHistory } from "./intake";
import { seedCanon } from "./canon";
import { groundQuery } from "../search/grounding";
import { DOMAINS } from "../visuals/catalog";
import type { TopicBrief } from "../types";

/** Search query for grounding a topic's outline in current info (web-search spec §5, extended to
 *  topic generation) — biases the tree toward the field as it stands today. */
function outlineQuery(title: string): string {
  return `${title} — current overview, the main subtopics that structure the field, and recent developments`;
}

const OutlineSchema = z.object({
  title: z
    .string()
    .describe(
      "a concise, well-formed subject title in Title Case (2-6 words). Refine the " +
        'learner\'s raw phrasing into a proper topic name — e.g. "i want to understand ' +
        'how modern LLMs work" becomes "Modern Large Language Models". Not a sentence, ' +
        "no first person, no leading verbs like 'understand' or 'learn'.",
    ),
  concepts: z
    .array(
      z.object({
        title: z.string().describe("short concept name, 2-5 words"),
        rationale: z.string().describe("one line on what it covers / why it matters"),
        domains: z
          .array(z.enum(DOMAINS))
          .describe("1-2 subject domains for this concept (multi-tag) from the allowed set — drives which visuals its lesson reaches for"),
        children: z
          .array(
            z.object({
              title: z.string(),
              rationale: z.string(),
              domains: z.array(z.enum(DOMAINS)).describe("1-2 subject domains for this sub-concept"),
            }),
          )
          .optional()
          .describe("2-4 sub-concepts, optional"),
      }),
    )
    .describe("4-7 top-level concepts, ordered foundational -> advanced"),
});

export type Outline = z.infer<typeof OutlineSchema>;
export type OutlineConcept = Outline["concepts"][number];

export async function outlineTopic(
  title: string,
  brief?: TopicBrief | null,
): Promise<Outline> {
  const briefBlock = brief
    ? `\n\nLearner brief (tailor the tree's depth, scope, and emphasis to this):
${brief.summary}
${formatHistory(brief.answers)}`
    : "";
  // Ground the tree in current web info so its structure/subtopics reflect the field today. Waits for
  // the search (up to GROUND_TIMEOUT_MS) then proceeds; best-effort — "" when search is off/unavailable,
  // so topic creation is never blocked or broken by a search problem.
  const grounding = await groundQuery(outlineQuery(title));
  const groundingBlock = grounding
    ? `\n\n${grounding}\nUse these current findings to make the tree reflect the field as it stands TODAY: prefer current subtopics and terminology, fold in genuinely important recent developments, and don't anchor only to older framings. Ignore anything off-topic or low-quality.`
    : "";
  const { output } = await generateText({
    model: getModel(),
    output: Output.object({ schema: OutlineSchema }),
    prompt: `You are mapping a subject into a learning tree for a curious learner.

Topic (as the learner phrased it): "${title}"${briefBlock}${groundingBlock}

First, refine the learner's phrasing into a clean subject title (see the title field).
Then produce 4-7 top-level concepts forming a coherent path from foundations to depth.
For each, optionally include 2-4 sub-concepts that break it down. Keep concept titles short
(2-5 words). Give a one-line rationale per concept. Order foundational -> advanced. Tag each
concept (and sub-concept) with 1-2 \`domains\` — the subjects it belongs to — from the allowed set.`,
  });
  return output;
}

/** Generate a topic's outline and persist it as a concept tree.
 *  Returns the new topic id and the root concept to open first. */
export async function startTopic(
  title: string,
  brief?: TopicBrief | null,
): Promise<{ topicId: string; rootConceptId: string }> {
  const { title: refined, concepts: outline } = await outlineTopic(title, brief);
  // Prefer the model's polished title; fall back to the learner's raw input.
  const topicTitle = refined.trim() || title;
  const now = Date.now();
  const topicId = crypto.randomUUID();
  const rootId = crypto.randomUUID();

  await topicRepo.create({ id: topicId, title: topicTitle, rootConceptId: rootId, brief: brief ?? null, createdAt: now });
  await conceptRepo.create({
    id: rootId,
    topicId,
    parentId: null,
    title: topicTitle,
    status: "current",
    state: "outline",
    order: 0,
    mastery: 0,
    remedial: false,
    createdAt: now,
  });

  // Collected flat for canon seeding (parents + children) — the rationale doubles
  // as the concept summary the canon author reads.
  const seedConcepts: { id: string; title: string; summary?: string | null }[] = [];

  let order = 0;
  for (const concept of outline) {
    const cid = crypto.randomUUID();
    await conceptRepo.create({
      id: cid,
      topicId,
      parentId: rootId,
      title: concept.title,
      summary: concept.rationale,
      domains: concept.domains,
      status: "queued",
      state: "outline",
      order: order++,
      mastery: 0,
      remedial: false,
      createdAt: now,
    });
    seedConcepts.push({ id: cid, title: concept.title, summary: concept.rationale });
    let childOrder = 0;
    for (const child of concept.children ?? []) {
      const childId = crypto.randomUUID();
      await conceptRepo.create({
        id: childId,
        topicId,
        parentId: cid,
        title: child.title,
        summary: child.rationale,
        domains: child.domains,
        status: "queued",
        state: "outline",
        order: childOrder++,
        mastery: 0,
        remedial: false,
        createdAt: now,
      });
      seedConcepts.push({ id: childId, title: child.title, summary: child.rationale });
    }
  }
  // Seed the Course Canon from the fresh tree — fire-and-forget so the tree renders
  // immediately. seedCanon swallows + logs its own failures; the .catch is belt-and-
  // suspenders so an unhandled rejection can never surface.
  void seedCanon({ topicId, topicTitle, brief, concepts: seedConcepts, rootConceptId: rootId }).catch(() => {});
  return { topicId, rootConceptId: rootId };
}
