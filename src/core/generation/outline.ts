// GenerationService — topic outlining. Generates a concept-tree skeleton up
// front (fast, navigable); lesson bodies generate lazily on visit in M3.
//
// Topic-creation flow (K3): a topic starts as a hidden `draft` row the moment the
// compose screen needs one (so attachments have a real topicId to bind to), then
// finalizeDraftTopic streams the outline — grounded in the draft's library — and
// promotes the row to `ready`. The outline STREAMS (partialOutputStream, the
// lesson pattern) so the creating screen reveals concepts as they're planned.
import { streamText, Output } from "ai";
import { z } from "zod";
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { getModelFor } from "../ai/service";
import { topicRepo, conceptRepo, sourceRepo } from "../store/repositories";
import { outlineGrounding, probeCitations } from "../knowledge/retrieve";
import { awaitTopicIngestion, removeTopicSources } from "../knowledge/ingest";
import { formatHistory } from "./intake";
import { seedCanon } from "./canon";
import { groundQuery } from "../search/grounding";
import { DOMAINS } from "../visuals/catalog";
import { dlog } from "../debug";
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
/** A streaming partial of the outline — concepts arrive incrementally. */
export type PartialOutline = {
  title?: string;
  concepts?: ({ title?: string; rationale?: string; children?: ({ title?: string } | undefined)[] } | undefined)[];
};

export interface OutlineOptions {
  /** draft topicId whose library grounds the outline (attachments shape the tree) */
  topicId?: string;
  /** incremental reveal for the creating screen — called per streamed partial */
  onPartial?: (partial: PartialOutline) => void;
  signal?: AbortSignal;
}

// The lesson generator's proven guard: native structured decoding stalls on
// larger schemas; the JSON tool path still streams partial object input.
const anthropicStructuredOptions = {
  anthropic: { structuredOutputMode: "jsonTool" } satisfies AnthropicLanguageModelOptions,
};

export async function outlineTopic(
  title: string,
  brief?: TopicBrief | null,
  opts: OutlineOptions = {},
): Promise<Outline> {
  const briefBlock = brief
    ? `\n\nLearner brief (tailor the tree's depth, scope, and emphasis to this):
${brief.summary}
${formatHistory(brief.answers)}`
    : "";
  // Ground the tree in the learner's attached materials first (syllabus shapes the
  // spine), then in current web info. Both best-effort — "" never blocks creation.
  const library = opts.topicId ? await outlineGrounding(opts.topicId, title) : "";
  const libraryBlock = library ? `\n\n${library}` : "";
  const grounding = await groundQuery(outlineQuery(title), { signal: opts.signal });
  const groundingBlock = grounding
    ? `\n\n${grounding}\nUse these current findings to make the tree reflect the field as it stands TODAY: prefer current subtopics and terminology, fold in genuinely important recent developments, and don't anchor only to older framings. Ignore anything off-topic or low-quality.`
    : "";
  const result = streamText({
    model: getModelFor("outline"),
    output: Output.object({ schema: OutlineSchema }),
    providerOptions: anthropicStructuredOptions,
    abortSignal: opts.signal,
    prompt: `You are mapping a subject into a learning tree for a curious learner.

Topic (as the learner phrased it): "${title}"${briefBlock}${libraryBlock}${groundingBlock}

First, refine the learner's phrasing into a clean subject title (see the title field).
Then produce 4-7 top-level concepts forming a coherent path from foundations to depth.
For each, optionally include 2-4 sub-concepts that break it down. Keep concept titles short
(2-5 words). Give a one-line rationale per concept. Order foundational -> advanced. Tag each
concept (and sub-concept) with 1-2 \`domains\` — the subjects it belongs to — from the allowed set.`,
  });
  const outputPromise = result.output;
  void outputPromise.then(undefined, () => {});
  for await (const partial of result.partialOutputStream) {
    opts.onPartial?.(partial as PartialOutline);
  }
  return await outputPromise;
}

// --- Draft topic lifecycle (topic-creation flow K3) ---

/** Create the hidden draft row the compose screen binds attachments to. */
export async function createDraftTopic(rawTitle: string): Promise<string> {
  const id = crypto.randomUUID();
  await topicRepo.create({
    id,
    title: rawTitle.trim() || "New topic",
    rootConceptId: null,
    status: "draft",
    brief: null,
    createdAt: Date.now(),
  });
  return id;
}

/** Cancel a compose session: remove the draft's source bindings (blob-aware),
 *  then the draft row. Never throws. */
export async function deleteDraftTopic(topicId: string): Promise<void> {
  try {
    await removeTopicSources(topicId);
    await topicRepo.remove(topicId);
  } catch (err) {
    dlog("outline", "draft delete failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Startup sweep: any draft at app launch is an abandoned compose session —
 *  delete it (and its bindings). Compose state is session-only by design. */
export async function sweepDraftTopics(): Promise<void> {
  try {
    for (const draft of await topicRepo.listDrafts()) {
      dlog("outline", "sweeping stale draft:", draft.title);
      await deleteDraftTopic(draft.id);
    }
  } catch (err) {
    dlog("outline", "draft sweep failed:", err instanceof Error ? err.message : String(err));
  }
}

export interface FinalizeResult {
  topicId: string;
  rootConceptId: string;
  /** concepts whose lessons will cite library sources (FTS probe) — the design's
   *  "cited" badges + "N lessons cite your sources" receipt */
  citedConceptIds: string[];
  /** the same set as concept titles — the creating UI reveals by title, not id */
  citedTitles: string[];
}

/** Finalize a draft: stream the outline (grounded in the draft's library), persist
 *  the concept tree into the EXISTING draft row, promote it to `ready`, and probe
 *  which concepts will cite sources. The draft-first order is what lets an uploaded
 *  syllabus shape the tree — the outline runs AFTER attachments are indexed. */
export async function finalizeDraftTopic(
  topicId: string,
  title: string,
  brief?: TopicBrief | null,
  opts: Pick<OutlineOptions, "onPartial" | "signal"> = {},
): Promise<FinalizeResult> {
  // Invariant: the outline is grounded in EXTRACTED docs, never planned before them.
  // The UI store already waits, but enforce it here too so any caller is correct.
  await awaitTopicIngestion(topicId);
  const { title: refined, concepts: outline } = await outlineTopic(title, brief, { ...opts, topicId });
  // Prefer the model's polished title; fall back to the learner's raw input.
  const topicTitle = refined.trim() || title;
  const now = Date.now();
  const rootId = crypto.randomUUID();

  // Record which library documents grounded this topic (the brief's "Grounded in" chips).
  const groundedIn = (await sourceRepo.listByTopic(topicId))
    .filter((e) => e.document.status === "ready")
    .map((e) => e.document.id);
  const finalBrief: TopicBrief | null = brief ? { ...brief, groundedIn } : null;

  // Retry-safe: a prior finalize that failed AFTER creating some concepts would
  // otherwise duplicate them. Clear any concepts already under this draft (sources
  // and the draft row itself are untouched — only the half-built tree goes).
  const prior = await conceptRepo.byTopic(topicId);
  if (prior.length) await conceptRepo.removeMany(prior.map((c) => c.id));

  await topicRepo.update(topicId, { title: topicTitle, rootConceptId: rootId, brief: finalBrief, status: "ready" });
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
  void seedCanon({ topicId, topicTitle, brief: finalBrief, concepts: seedConcepts, rootConceptId: rootId }).catch(() => {});

  // "N lessons cite your sources": which concepts have matching library passages.
  const citedIds = await probeCitations(topicId, seedConcepts);
  const citedConceptIds = [...citedIds];
  const citedTitles = seedConcepts.filter((c) => citedIds.has(c.id)).map((c) => c.title);
  return { topicId, rootConceptId: rootId, citedConceptIds, citedTitles };
}

/** Generate a topic's outline and persist it as a concept tree — the pre-K3 entry
 *  point, now draft-then-finalize under the hood (identical result for callers
 *  with no attachments). Returns the new topic id and root concept to open. */
export async function startTopic(
  title: string,
  brief?: TopicBrief | null,
): Promise<{ topicId: string; rootConceptId: string }> {
  const topicId = await createDraftTopic(title);
  try {
    const { rootConceptId } = await finalizeDraftTopic(topicId, title, brief);
    return { topicId, rootConceptId };
  } catch (err) {
    await deleteDraftTopic(topicId); // a failed creation must not strand a draft
    throw err;
  }
}
