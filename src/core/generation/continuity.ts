// GenerationService — the continuity/handoff section (Continuity Engine B4), the
// hero of the engine. buildContinuitySection assembles a prompt fragment from the
// Course Canon + the digests of a BOUNDED set of related lessons (ancestors,
// siblings, prereqs, referrer) and hands it to the lesson generator so a new lesson
// reads as the next beat of one continuous course rather than a fresh article.
//
// It is graceful and on-demand: a handful of fast local SQLite reads run just before
// generation, the whole body is wrapped so it NEVER throws, and when there is nothing
// to inject (no canon, no digests) it returns "" — the lesson then generates exactly
// as it does today, preserving arbitrary forking order. Lessons not yet generated
// simply contribute nothing.
//
// The pure string-composition lives in formatContinuitySection (no DB), so the hero
// text is unit-tested directly; buildContinuitySection gathers data then calls it.
import { dlog } from "../debug";
import { canonRepo, conceptRepo, lessonRepo, type ConceptRow } from "../store/repositories";
import { retrieveRelated } from "./semanticIndex";
import type { CanonNotation, LessonDigest } from "../types";
import type { LessonContext } from "./lessonPrompt";

/** The canon subset the formatter needs — structurally compatible with CourseCanonRow. */
export interface ContinuityCanon {
  spine: { arc: string };
  notation: { symbol: string; means: string }[];
  voice: { tone: string; depth: string; pacing: string };
}

/** A prior lesson that has a digest, surfaced to the formatter by title. */
export interface ContinuityPrior {
  title: string;
  digest: LessonDigest;
}

export interface FormatContinuityInput {
  canon: ContinuityCanon | null;
  /** spine neighbours of THIS concept, already resolved to titles (omit if absent) */
  spinePrev?: string | null;
  spineNext?: string | null;
  /** the lesson the learner arrived from (recap when its digest exists) */
  referrer?: { title: string; recap: string } | null;
  /** the lesson the learner arrived from when it has no digest yet — title only */
  referrerTitleOnly?: string | null;
  /** canonical notation for the topic (omit/empty to skip the notation block) */
  notation?: CanonNotation[];
  /** prereq concept titles THIS concept builds on (omit/empty to skip) */
  prereqTitles?: string[];
  /** ancestors + prereqs + siblings whose lessons already have a digest */
  priors: ContinuityPrior[];
  /** the learner's demonstrated mastery of this concept's prerequisites (B5) */
  learner?: { title: string; mastery: number }[];
}

// --- small local formatting helpers ---

const list = (xs: string[]): string => xs.join(", ");

/** One bullet for a prior lesson: recap, plus any open loops / deferrals it left. */
function priorBullet(p: ContinuityPrior): string {
  const loops = p.digest.openLoops?.length ? ` Open loops it left: ${p.digest.openLoops.join("; ")}.` : "";
  const deferred = p.digest.deferredTo?.length ? ` It deferred: ${p.digest.deferredTo.join("; ")}.` : "";
  return `- "${p.title}": ${p.digest.recap}${loops}${deferred}`;
}

/**
 * Pure composition of the continuity section (no DB/AI). Each part is omitted when it
 * has no data; the whole thing is "" when nothing applies. The CONTINUITY RULES block
 * is always present whenever the section is non-empty.
 */
export function formatContinuitySection(input: FormatContinuityInput): string {
  const { canon, spinePrev, spineNext, referrer, referrerTitleOnly, prereqTitles, priors } = input;
  const notation = input.notation ?? [];

  // (a) Canon header — arc + voice, then optional spine position / notation / prereqs.
  let canonBlock = "";
  if (canon) {
    const parts: string[] = [
      `THIS LESSON IS PART OF A CONTINUOUS COURSE — build on what came before; do not start over.`,
      `Course through-line: ${canon.spine.arc}`,
      `Match the established voice: ${canon.voice.tone}; depth: ${canon.voice.depth}; pacing: ${canon.voice.pacing}.`,
    ];

    if (spinePrev && spineNext) {
      parts.push(`On the course spine this comes after "${spinePrev}" and leads into "${spineNext}".`);
    } else if (spinePrev) {
      parts.push(`On the course spine this comes after "${spinePrev}".`);
    } else if (spineNext) {
      parts.push(`On the course spine this leads into "${spineNext}".`);
    }

    if (notation.length) {
      const lines = notation.map((n) => `  - ${n.symbol} = ${n.means}`).join("\n");
      parts.push(`Use this canonical notation EXACTLY — never reintroduce a symbol under a new name:\n${lines}`);
    }

    if (prereqTitles && prereqTitles.length) {
      parts.push(`This concept builds on: ${list(prereqTitles)}.`);
    }

    canonBlock = parts.join("\n");
  }

  // (b) Referrer bridge — full recap when its digest exists, else title-only fallback.
  let referrerBlock = "";
  if (referrer) {
    referrerBlock = [
      `The learner arrived here from "${referrer.title}", which established: ${referrer.recap}`,
      `Open by bridging from that — pick up the thread in your first sentences; do NOT re-motivate the whole subject.`,
    ].join("\n");
  } else if (referrerTitleOnly) {
    referrerBlock = `The learner arrived here from "${referrerTitleOnly}" — open by connecting to it.`;
  }

  // (c) Prior lessons — ancestors + prereqs + siblings that already have a digest.
  let priorsBlock = "";
  if (priors.length) {
    const bullets = priors.map(priorBullet).join("\n");
    priorsBlock = `What specific prior lessons already established (reference these precisely by name where it genuinely helps — NEVER reference or imply a prior lesson that is not listed here, and never invent one):\n${bullets}`;
  }

  // (c2) Learner state — adapt depth to THIS learner's demonstrated mastery of the
  // prerequisites (B5): solid → a one-line callback; weak → fold in a quick refresher.
  let learnerBlock = "";
  const learner = input.learner ?? [];
  if (learner.length) {
    const lines = learner
      .map((l) => {
        const level = l.mastery >= 0.7 ? "solid" : l.mastery <= 0.4 ? "weak" : "partial";
        return `  - ${l.title}: mastery ${l.mastery.toFixed(2)} (${level})`;
      })
      .join("\n");
    learnerBlock = `LEARNER STATE — tailor depth to what THIS learner has demonstrated on the prerequisites:\n${lines}\nFor a SOLID prereq a one-line callback is enough; for a WEAK one, fold in a brief refresher before building on it.`;
  }

  // (d) Continuity rules — always present when the section is non-empty.
  const rulesBlock = [
    `CONTINUITY RULES:`,
    `- Begin by connecting to where the learner came from; never restart the topic or re-introduce its motivation from scratch.`,
    `- Use the canonical notation above verbatim; reuse established motifs and ADVANCE the running example rather than inventing a brand-new one.`,
    `- Make precise back-references to specific named prior lessons above ("the gradient we met in Optimization"); never vague ("as we discussed"), and never to a lesson not listed above.`,
    `- If this lesson answers an open loop left by a prior lesson above, close it explicitly.`,
    `- End by handing off forward: frame each suggestedFork as a promise the next lesson will honor, and phrase suggestedLessons as "next on the path".`,
  ].join("\n");

  const body = [canonBlock, referrerBlock, priorsBlock, learnerBlock].filter(Boolean);
  if (body.length === 0) return "";
  return [...body, rulesBlock].join("\n\n");
}

/**
 * Assemble the continuity section for a concept about to be generated. Gathers the
 * Course Canon and the digests of a bounded related set (ancestors via parentId,
 * siblings, canon prereqs, and the referrer), then delegates to
 * formatContinuitySection. Returns "" on any failure or when there is nothing to
 * inject, so lesson generation is never blocked or broken.
 */
export async function buildContinuitySection(concept: ConceptRow, ctx: LessonContext): Promise<string> {
  try {
    const canon = await canonRepo.get(concept.topicId);

    const all = await conceptRepo.byTopic(concept.topicId);
    const titleById = new Map(all.map((c) => [c.id, c.title]));
    const byId = new Map(all.map((c) => [c.id, c]));

    // --- bounded related set (deduped, excludes the concept itself) ---
    const relatedIds = new Set<string>();

    // ancestors: walk up via parentId from concept.parentId to the root.
    let cursor: string | null = concept.parentId ?? null;
    const guard = new Set<string>(); // cycle guard for malformed parent chains
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      relatedIds.add(cursor);
      const parent = byId.get(cursor) ?? (await conceptRepo.get(cursor));
      cursor = parent?.parentId ?? null;
    }

    // siblings: same parent, not self.
    for (const c of all) {
      if (c.parentId === concept.parentId && c.id !== concept.id) relatedIds.add(c.id);
    }

    // prereqs from the canon's cross-tree "builds on" graph.
    const prereqIds = canon?.prereqs[concept.id] ?? [];
    for (const id of prereqIds) relatedIds.add(id);

    // referrer the learner navigated from.
    const referrerId = ctx.referrer && ctx.referrer !== concept.id ? ctx.referrer : null;
    if (referrerId) relatedIds.add(referrerId);

    relatedIds.delete(concept.id);

    // --- fetch each related lesson once; keep those with a non-null digest ---
    const digestById = new Map<string, { title: string; digest: LessonDigest }>();
    await Promise.all(
      [...relatedIds].map(async (id) => {
        const row = await lessonRepo.get(id);
        if (row?.digest) digestById.set(id, { title: row.title, digest: row.digest });
      }),
    );

    // SemanticIndex (B7): fold in the top-k related already-generated lessons across the whole
    // tree. Gated on an embeddings provider — dormant + [] otherwise, so canon prereqs + tree
    // neighbors remain the always-on floor.
    const semantic = await retrieveRelated(concept.id, `${concept.title} ${concept.summary ?? ""}`);
    for (const r of semantic) {
      if (!digestById.has(r.conceptId)) digestById.set(r.conceptId, { title: r.title, digest: r.digest });
    }

    // Today's behavior: nothing to say at all → contribute nothing.
    if (!canon && digestById.size === 0) return "";

    // --- referrer bridge: prefer its digest recap; else fall back to a known title ---
    let referrer: { title: string; recap: string } | null = null;
    let referrerTitleOnly: string | null = null;
    if (referrerId) {
      const hit = digestById.get(referrerId);
      if (hit) referrer = { title: hit.title, recap: hit.digest.recap };
      else {
        const t = titleById.get(referrerId);
        if (t) referrerTitleOnly = t;
      }
    }

    // --- prior lessons: every related digest EXCEPT the one used as the referrer
    // bridge (so it isn't both the bridge and a bullet). ---
    const priors: { title: string; digest: LessonDigest }[] = [];
    for (const [id, entry] of digestById) {
      if (referrer && id === referrerId) continue;
      priors.push(entry);
    }

    // --- spine neighbours of this concept (titles), if it sits on the spine ---
    let spinePrev: string | null = null;
    let spineNext: string | null = null;
    const order = canon?.spine.order ?? [];
    const pos = order.indexOf(concept.id);
    if (pos >= 0) {
      const prevId = pos > 0 ? order[pos - 1] : null;
      const nextId = pos < order.length - 1 ? order[pos + 1] : null;
      spinePrev = prevId ? titleById.get(prevId) ?? null : null;
      spineNext = nextId ? titleById.get(nextId) ?? null : null;
    }

    const prereqTitles = prereqIds
      .map((id) => titleById.get(id))
      .filter((t): t is string => Boolean(t));

    // Learner state for the prereqs (B5): their demonstrated mastery, from the concept rows.
    const learner = prereqIds
      .map((id) => byId.get(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({ title: c.title, mastery: c.mastery }));

    return formatContinuitySection({
      canon: canon ? { spine: { arc: canon.spine.arc }, notation: canon.notation, voice: canon.voice } : null,
      spinePrev,
      spineNext,
      referrer,
      referrerTitleOnly,
      notation: canon?.notation ?? [],
      prereqTitles,
      priors,
      learner,
    });
  } catch (err) {
    dlog("continuity", "build failed:", err instanceof Error ? err.message : String(err));
    return "";
  }
}
