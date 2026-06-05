// Typed repositories — the ONLY way the rest of the app touches the store.
// Components/services never import drizzle directly; this seam is what lets us
// later swap in a reactive layer (TanStack DB) or a sync engine without UI churn.
import { asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "./client";
import { topics, concepts, conceptLinks, lessons, notes, chatTurns, teachAttempts, highlights, usageEvents } from "./schema";

export type TopicInsert = typeof topics.$inferInsert;
export type TopicRow = typeof topics.$inferSelect;
export type ConceptInsert = typeof concepts.$inferInsert;
export type ConceptRow = typeof concepts.$inferSelect;
export type LessonInsert = typeof lessons.$inferInsert;
export type ConceptLinkInsert = typeof conceptLinks.$inferInsert;
export type ConceptLinkRow = typeof conceptLinks.$inferSelect;
export type NoteInsert = typeof notes.$inferInsert;
export type ChatTurnInsert = typeof chatTurns.$inferInsert;
export type TeachAttemptInsert = typeof teachAttempts.$inferInsert;
export type TeachAttemptRow = typeof teachAttempts.$inferSelect;
export type HighlightInsert = typeof highlights.$inferInsert;
export type HighlightRow = typeof highlights.$inferSelect;
export type UsageEventInsert = typeof usageEvents.$inferInsert;
export type UsageEventRow = typeof usageEvents.$inferSelect;

/** All-time usage roll-up. `hasUnknownCost` is true when any event couldn't be
 *  priced, so the UI can flag the dollar total as a lower bound. */
export interface UsageTotals {
  events: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  hasUnknownCost: boolean;
}

export interface UsageByModel {
  provider: string;
  model: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  hasUnknownCost: boolean;
}

/** One UTC day's spend, for the 30-day sparkline. */
export interface UsageDay {
  day: string; // YYYY-MM-DD
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export const topicRepo = {
  list: () => db.select().from(topics).orderBy(asc(topics.createdAt)).all(),
  get: (id: string) => db.select().from(topics).where(eq(topics.id, id)).get(),
  create: (value: TopicInsert) => db.insert(topics).values(value).run(),
};

export const conceptRepo = {
  byTopic: (topicId: string) =>
    db.select().from(concepts).where(eq(concepts.topicId, topicId)).orderBy(asc(concepts.order)).all(),
  get: (id: string) => db.select().from(concepts).where(eq(concepts.id, id)).get(),
  create: (value: ConceptInsert) => db.insert(concepts).values(value).run(),
  update: (id: string, patch: Partial<ConceptInsert>) =>
    db.update(concepts).set(patch).where(eq(concepts.id, id)).run(),
  /** Move a set of nodes under a new parent (null = topic root). Used by the
   *  "keep sub-concepts" delete path to lift a deleted node's children up. No-op
   *  on an empty set. */
  reparent: (ids: string[], newParentId: string | null) =>
    ids.length === 0
      ? Promise.resolve()
      : db.update(concepts).set({ parentId: newParentId }).where(inArray(concepts.id, ids)).run(),
  /** Hard-delete a set of concepts and everything that FK-references them, in an
   *  order that satisfies those references (dependents first, concepts last).
   *  `ids` is the full set to remove (e.g. a subtree from `descendantIds`); callers
   *  compute it. conceptLinks are dropped when EITHER endpoint is removed so no edge
   *  is left dangling. Sequential (the sqlite-proxy has no transaction seam yet);
   *  fine for a local single-user store. */
  removeMany: async (ids: string[]) => {
    if (ids.length === 0) return;
    await db
      .delete(conceptLinks)
      .where(or(inArray(conceptLinks.sourceConceptId, ids), inArray(conceptLinks.targetConceptId, ids)))
      .run();
    await db.delete(highlights).where(inArray(highlights.conceptId, ids)).run();
    await db.delete(notes).where(inArray(notes.conceptId, ids)).run();
    await db.delete(chatTurns).where(inArray(chatTurns.conceptId, ids)).run();
    await db.delete(teachAttempts).where(inArray(teachAttempts.conceptId, ids)).run();
    await db.delete(lessons).where(inArray(lessons.conceptId, ids)).run();
    await db.delete(concepts).where(inArray(concepts.id, ids)).run();
  },
};

export const lessonRepo = {
  get: (conceptId: string) => db.select().from(lessons).where(eq(lessons.conceptId, conceptId)).get(),
  upsert: (value: LessonInsert) =>
    db.insert(lessons).values(value).onConflictDoUpdate({ target: lessons.conceptId, set: value }).run(),
};

/** Cross-link edges between concepts (the graph layer beyond the parent/child
 *  tree). Inserts are idempotent — the unique (source, target) index makes a
 *  repeat insert a no-op, so eager edge creation never doubles up. */
export const linkRepo = {
  byTopic: (topicId: string) =>
    db.select().from(conceptLinks).where(eq(conceptLinks.topicId, topicId)).all(),
  /** edges pointing OUT of a concept ("relates to …") */
  outgoing: (conceptId: string) =>
    db.select().from(conceptLinks).where(eq(conceptLinks.sourceConceptId, conceptId)).all(),
  /** edges pointing INTO a concept (backlinks: "referenced by …") */
  incoming: (conceptId: string) =>
    db.select().from(conceptLinks).where(eq(conceptLinks.targetConceptId, conceptId)).all(),
  create: (value: ConceptLinkInsert) =>
    db.insert(conceptLinks).values(value).onConflictDoNothing().run(),
};

export const noteRepo = {
  byConcept: (conceptId: string) =>
    db.select().from(notes).where(eq(notes.conceptId, conceptId)).orderBy(asc(notes.createdAt)).all(),
  create: (value: NoteInsert) => db.insert(notes).values(value).run(),
};

export const chatRepo = {
  byConcept: (conceptId: string) =>
    db.select().from(chatTurns).where(eq(chatTurns.conceptId, conceptId)).orderBy(asc(chatTurns.createdAt)).all(),
  append: (value: ChatTurnInsert) => db.insert(chatTurns).values(value).run(),
};

export const teachRepo = {
  byConcept: (conceptId: string) =>
    db
      .select()
      .from(teachAttempts)
      .where(eq(teachAttempts.conceptId, conceptId))
      .orderBy(asc(teachAttempts.createdAt))
      .all(),
  create: (value: TeachAttemptInsert) => db.insert(teachAttempts).values(value).run(),
};

/** A learner's personal highlights on a concept's lesson prose. */
export const highlightRepo = {
  byConcept: (conceptId: string) =>
    db.select().from(highlights).where(eq(highlights.conceptId, conceptId)).orderBy(asc(highlights.createdAt)).all(),
  create: (value: HighlightInsert) => db.insert(highlights).values(value).run(),
  setGloss: (id: string, gloss: string) =>
    db.update(highlights).set({ gloss }).where(eq(highlights.id, id)).run(),
  remove: (id: string) => db.delete(highlights).where(eq(highlights.id, id)).run(),
};

/** Token-usage ledger. Append-only inserts (from the AI usage middleware) plus
 *  the aggregations the Settings Usage view reads. Tokens summed in SQL; cost is
 *  the pre-computed per-event snapshot, so totals are a simple SUM. */
export const usageRepo = {
  insert: (value: UsageEventInsert) => db.insert(usageEvents).values(value).run(),

  totals: async (): Promise<UsageTotals> => {
    const r = await db
      .select({
        events: sql<number>`count(*)`,
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
        cachedInputTokens: sql<number>`coalesce(sum(${usageEvents.cachedInputTokens}), 0)`,
        costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
        unknown: sql<number>`coalesce(sum(case when ${usageEvents.costSource} = 'unknown' then 1 else 0 end), 0)`,
      })
      .from(usageEvents)
      .get();
    return {
      events: r?.events ?? 0,
      inputTokens: r?.inputTokens ?? 0,
      outputTokens: r?.outputTokens ?? 0,
      cachedInputTokens: r?.cachedInputTokens ?? 0,
      costUsd: r?.costUsd ?? 0,
      hasUnknownCost: (r?.unknown ?? 0) > 0,
    };
  },

  byModel: async (): Promise<UsageByModel[]> => {
    const rows = await db
      .select({
        provider: usageEvents.provider,
        model: usageEvents.model,
        events: sql<number>`count(*)`,
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
        costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
        unknown: sql<number>`coalesce(sum(case when ${usageEvents.costSource} = 'unknown' then 1 else 0 end), 0)`,
      })
      .from(usageEvents)
      .groupBy(usageEvents.provider, usageEvents.model)
      .all();
    return rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      events: r.events,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd,
      hasUnknownCost: r.unknown > 0,
    }));
  },

  /** Per-day spend since `sinceMs` (UTC day buckets), unordered. */
  daily: async (sinceMs: number): Promise<UsageDay[]> => {
    const dayExpr = sql<string>`strftime('%Y-%m-%d', ${usageEvents.createdAt} / 1000, 'unixepoch')`;
    return db
      .select({
        day: dayExpr,
        costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
      })
      .from(usageEvents)
      .where(sql`${usageEvents.createdAt} >= ${sinceMs}`)
      .groupBy(dayExpr)
      .all();
  },

  clear: () => db.delete(usageEvents).run(),
};
