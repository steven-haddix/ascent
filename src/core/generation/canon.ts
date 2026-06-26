// GenerationService — the Course Canon (Continuity Engine B1). The canon is a
// per-topic "one-author charter": the narrative arc + spine order, a notation
// registry, 1-3 motifs, a tone/depth/pacing voice, and a cross-tree prereq graph.
// It is seeded once from the freshly-outlined tree (seedCanon), kept living as
// concepts fork in (placeForkedConcept), and advanced by each lesson's digest
// (mergeDigestIntoCanon). All AI here resolves through getModelFor("canon") — never
// a hardcoded model — and every entry point swallows + logs its own failures so the
// learner-facing tree never blocks on canon work.
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModelFor } from "../ai/service";
import { canonRepo, conceptRepo } from "../store/repositories";
import { DOMAINS } from "../visuals/catalog";
import { dlog } from "../debug";
import type { CanonNotation, LessonDigest, TopicBrief } from "../types";

// --- Pure helpers (unit-tested; no DB/AI) ---

/** Append additions to existing notation, deduped by symbol (existing wins). */
export function mergeNotationLists(existing: CanonNotation[], additions: CanonNotation[]): CanonNotation[] {
  const bySymbol = new Map(existing.map((n) => [n.symbol, n]));
  for (const a of additions) if (a.symbol && !bySymbol.has(a.symbol)) bySymbol.set(a.symbol, a);
  return [...bySymbol.values()];
}

/** Insert `id` into the spine order right after `afterId` (append if afterId is
 *  null/absent/missing). No-op if `id` is already present. Returns a new array. */
export function placeInSpineOrder(order: string[], id: string, afterId?: string | null): string[] {
  if (order.includes(id)) return order;
  if (!afterId) return [...order, id];
  const i = order.indexOf(afterId);
  if (i < 0) return [...order, id];
  const next = [...order];
  next.splice(i + 1, 0, id);
  return next;
}

// --- seedCanon: build the canon from the freshly-created concept tree ---

const CanonSchema = z.object({
  arc: z
    .string()
    .describe(
      "2-4 sentences: the topic's narrative arc — feel the problem → simplest thing that works → watch it break → earn each fix",
    ),
  order: z
    .array(z.string())
    .describe("concept handles (e.g. 'c1') in ideal learning order along the spine"),
  notation: z
    .array(z.object({ symbol: z.string(), means: z.string() }))
    .describe(
      "canonical symbols/terms to keep consistent across the whole topic — empty for non-technical topics",
    ),
  motifs: z
    .array(z.object({ name: z.string(), description: z.string() }))
    .describe("1-3 through-line analogies/examples that should recur and evolve across lessons"),
  voice: z
    .object({ tone: z.string(), depth: z.string(), pacing: z.string() })
    .describe("the one-author charter for every lesson in this topic"),
  prereqs: z
    .array(z.object({ concept: z.string(), buildsOn: z.array(z.string()) }))
    .describe(
      "for each concept handle, the handles it builds on (cross-tree 'builds on'); omit/empty if foundational",
    ),
});

/** Seed a topic's Course Canon from its just-created concept tree. Fire-and-forget
 *  from startTopic — the tree must render immediately, so this never blocks and
 *  never throws (failures are logged and dropped). */
export async function seedCanon(input: {
  topicId: string;
  topicTitle: string;
  brief?: TopicBrief | null;
  concepts: { id: string; title: string; summary?: string | null }[];
  /** the topic root concept — front-loaded onto the spine so it has a real
   *  organizational position (the overview every other lesson follows). Without it the
   *  root has no spine index, and continuity has no "you are the start" signal. */
  rootConceptId?: string;
}): Promise<void> {
  try {
    // Assign each concept a stable handle (c1, c2, …) the model can cite — the same
    // indirection the lesson generator uses so ids never reach the model.
    const map: Record<string, string> = {};
    const lines = input.concepts.map((c, i) => {
      const handle = `c${i + 1}`;
      map[handle] = c.id;
      return `[${handle}] ${c.title}${c.summary ? ` — ${c.summary}` : ""}`;
    });

    const briefBlock = input.brief
      ? `\n\nLearner brief (tailor the arc, depth, and emphasis to this):\n${input.brief.summary}`
      : "";

    const prompt = `You are the lead author of a coherent learning course on a single topic. Establish the
"canon" every future lesson must honor so the whole topic reads as one author's voice with one
through-line — not a pile of disconnected articles.

Topic: "${input.topicTitle}"${briefBlock}

Concepts already mapped into the tree (reference them ONLY by these handles, e.g. "c1"):
${lines.join("\n")}

Produce the canon:
- arc: the topic's narrative spine in 2-4 sentences — feel the problem, reach for the simplest
  thing that works, watch it break, then earn each fix. This is the story the whole topic tells.
- order: the concept handles in the ideal order a learner should move along that spine
  (foundational → advanced). Include every handle exactly once; use ONLY the handles above.
- notation: a small registry of canonical symbols/terms to keep consistent across every lesson
  (each {symbol, means}). Leave it empty for non-technical topics.
- motifs: 1-3 through-line analogies or running examples that should recur and evolve as the
  learner advances (each {name, description}).
- voice: the one-author charter — {tone, depth, pacing} — every lesson in this topic should match.
- prereqs: the cross-tree "builds on" graph. For each concept handle that depends on others, give
  {concept, buildsOn} where buildsOn lists the handles it builds on. Omit foundational concepts or
  give them an empty buildsOn. Reference concepts ONLY by the handles above.`;

    const { output } = await generateText({
      model: getModelFor("canon"),
      output: Output.object({ schema: CanonSchema }),
      prompt,
    });

    // Resolve handles → ids. Drop any handle the model invented (filter Boolean).
    const order = output.order.map((h) => map[h]).filter(Boolean);
    // The root is the topic overview — it opens the spine, ahead of every concept it
    // introduces. Force it to the front (the model never sees it as a handle).
    if (input.rootConceptId && !order.includes(input.rootConceptId)) order.unshift(input.rootConceptId);
    const prereqs: Record<string, string[]> = {};
    for (const p of output.prereqs) {
      const conceptId = map[p.concept];
      if (!conceptId) continue;
      const buildsOnIds = p.buildsOn.map((h) => map[h]).filter(Boolean);
      if (buildsOnIds.length) prereqs[conceptId] = buildsOnIds;
    }
    // notation/motifs/voice pass through; notation entries get firstIntroducedIn: null
    // (they're declared at the topic level here, not pinned to a single lesson yet).
    const notation: CanonNotation[] = output.notation.map((n) => ({
      symbol: n.symbol,
      means: n.means,
      firstIntroducedIn: null,
    }));

    await canonRepo.upsert({
      topicId: input.topicId,
      spine: { arc: output.arc, order },
      notation,
      motifs: output.motifs.map((m) => ({ name: m.name, description: m.description, lastAdvancedIn: null })),
      voice: output.voice,
      prereqs,
      version: 1,
      updatedAt: Date.now(),
    });
    dlog("canon", "seeded:", input.topicTitle, `(${order.length} on spine)`);
  } catch (err) {
    dlog("canon", "seed failed:", err instanceof Error ? err.message : String(err));
  }
}

// --- placeForkedConcept: slot a newly-forked concept into the living canon (B1) ---

const PlacementSchema = z.object({
  afterConcept: z
    .string()
    .nullable()
    .describe("the title of the existing concept this new one should sit right after, or null to append"),
  buildsOn: z
    .array(z.string())
    .describe("titles of the existing concepts this new concept builds on (subset of the listed siblings)"),
  domains: z
    .array(z.enum(DOMAINS))
    .describe("1-2 subject domains this new concept belongs to (multi-tag), from the allowed set"),
});

/** Slot a freshly-forked concept into an existing canon: pick its spine position and
 *  prereqs relative to its siblings, bump the version. No-op if the topic has no canon
 *  yet (e.g. forked before seedCanon finished). Never throws. */
export async function placeForkedConcept(input: {
  topicId: string;
  concept: { id: string; title: string; summary?: string | null };
  siblings: { id: string; title: string }[];
}): Promise<void> {
  try {
    const canon = await canonRepo.get(input.topicId);
    if (!canon) return;

    const summary = input.concept.summary ? ` — ${input.concept.summary}` : "";
    const orderTitles = canon.spine.order
      .map((id) => input.siblings.find((s) => s.id === id)?.title)
      .filter((t): t is string => Boolean(t));
    const prompt = `You maintain the canon of a coherent learning course. A new concept has just been added to
the tree; place it on the spine.

The topic's narrative arc:
${canon.spine.arc || "(not yet established)"}

The current spine order (existing concepts, in order):
${orderTitles.length ? orderTitles.map((t) => `- ${t}`).join("\n") : "(empty)"}

New concept to place: "${input.concept.title}"${summary}

Return:
- afterConcept: the EXACT title of the existing concept this new one should sit right after on the
  spine, or null to append it at the end.
- buildsOn: the EXACT titles of existing concepts this new concept builds on (only titles from the
  list above; empty if it is foundational).
- domains: 1-2 subject domains this new concept belongs to, from the allowed set.`;

    const { output } = await generateText({
      model: getModelFor("canon"),
      output: Output.object({ schema: PlacementSchema }),
      prompt,
    });

    // Map titles → ids against the siblings (the new concept itself is already known).
    const idByTitle = new Map(input.siblings.map((s) => [s.title, s.id]));
    const afterId = output.afterConcept ? idByTitle.get(output.afterConcept) ?? null : null;
    const buildsOnIds = output.buildsOn
      .map((t) => idByTitle.get(t))
      .filter((id): id is string => Boolean(id) && id !== input.concept.id);

    const order = placeInSpineOrder(canon.spine.order, input.concept.id, afterId);
    const prereqs = { ...canon.prereqs, [input.concept.id]: buildsOnIds };

    await canonRepo.upsert({
      ...canon,
      spine: { ...canon.spine, order },
      prereqs,
      version: canon.version + 1,
      updatedAt: Date.now(),
    });
    // Refine the fork's domains with the LLM's classification — replaces the parent-inherited
    // default set synchronously at fork creation (B5 domain tagging).
    if (output.domains.length) await conceptRepo.update(input.concept.id, { domains: output.domains });
    dlog("canon", "placed fork:", input.concept.title);
  } catch (err) {
    dlog("canon", "place failed:", err instanceof Error ? err.message : String(err));
  }
}

// --- mergeDigestIntoCanon: fold a lesson's digest back into the canon (Task 1.4) ---

/** Fold a finished lesson's digest into the topic's canon: register any new notation
 *  (existing symbols win) and advance the motifs this lesson touched. No-op if the
 *  topic has no canon yet. Never throws.
 *
 *  Concurrency: this is a read-modify-write with last-writer-wins on the single
 *  course_canon row — acceptable for a local single-user store (spec B1). It runs only
 *  in the post-stream finalization pipeline, never inside the streaming path, so
 *  concurrent writers are not expected in practice. */
export async function mergeDigestIntoCanon(
  topicId: string,
  conceptId: string,
  digest: LessonDigest,
): Promise<void> {
  try {
    const canon = await canonRepo.get(topicId);
    if (!canon) return;

    const notation = mergeNotationLists(
      canon.notation,
      digest.notation.map((n) => ({ symbol: n.symbol, means: n.means, firstIntroducedIn: conceptId })),
    );

    // Advance a motif when this lesson's digest mentions it: its canonical name appears
    // (case-insensitive substring) in ANY of the digest's motif strings.
    const haystack = digest.motifs.map((m) => m.toLowerCase());
    const motifs = canon.motifs.map((m) => {
      const name = m.name.toLowerCase();
      const advanced = name.length > 0 && haystack.some((h) => h.includes(name));
      return advanced ? { ...m, lastAdvancedIn: conceptId } : m;
    });

    await canonRepo.upsert({
      ...canon,
      notation,
      motifs,
      version: canon.version + 1,
      updatedAt: Date.now(),
    });
    dlog("canon", "digest merged:", conceptId);
  } catch (err) {
    dlog("canon", "merge failed:", err instanceof Error ? err.message : String(err));
  }
}
