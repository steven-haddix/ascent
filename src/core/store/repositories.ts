// Typed repositories — the ONLY way the rest of the app touches the store.
// Components/services never import drizzle directly; this seam is what lets us
// later swap in a reactive layer (TanStack DB) or a sync engine without UI churn.
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "./client";
import { topics, concepts, conceptLinks, lessons, notes, chatTurns, teachAttempts, highlights, usageEvents, widgets, courseCanon, mediaAssets, resources } from "./schema";

export type TopicInsert = typeof topics.$inferInsert;
export type TopicRow = typeof topics.$inferSelect;
export type ConceptInsert = typeof concepts.$inferInsert;
export type ConceptRow = typeof concepts.$inferSelect;
export type LessonInsert = typeof lessons.$inferInsert;
export type LessonRow = typeof lessons.$inferSelect;
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
export type WidgetInsert = typeof widgets.$inferInsert;
export type WidgetRow = typeof widgets.$inferSelect;
export type CourseCanonInsert = typeof courseCanon.$inferInsert;
export type CourseCanonRow = typeof courseCanon.$inferSelect;
export type MediaAssetInsert = typeof mediaAssets.$inferInsert;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type ResourceInsert = typeof resources.$inferInsert;
export type ResourceRow = typeof resources.$inferSelect;

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
  /** Hard-delete a whole topic and everything under it. Every concept in the tree
   *  goes through conceptRepo.removeMany (which also drops each concept's lesson,
   *  notes, chat, teach-backs, highlights, widgets, media, and any concept_links it
   *  touches), then the topic's course canon, any links still keyed to the topic,
   *  and finally the topic row. Order satisfies the FK references (dependents first,
   *  topic last). Sequential like removeMany — fine for the local single-user store.
   *  Callers (useDeleteTopic) abort in-flight lesson streams first. */
  remove: async (id: string) => {
    const conceptIds = (await conceptRepo.byTopic(id)).map((c) => c.id);
    await conceptRepo.removeMany(conceptIds);
    await db.delete(conceptLinks).where(eq(conceptLinks.topicId, id)).run();
    await db.delete(courseCanon).where(eq(courseCanon.topicId, id)).run();
    await db.delete(topics).where(eq(topics.id, id)).run();
  },
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
    await db.delete(widgets).where(inArray(widgets.conceptId, ids)).run();
    await db.delete(mediaAssets).where(inArray(mediaAssets.conceptId, ids)).run();
    await db.delete(resources).where(inArray(resources.conceptId, ids)).run();
    await db.delete(lessons).where(inArray(lessons.conceptId, ids)).run();
    await db.delete(concepts).where(inArray(concepts.id, ids)).run();
  },
};

export const lessonRepo = {
  get: (conceptId: string) => db.select().from(lessons).where(eq(lessons.conceptId, conceptId)).get(),
  upsert: (value: LessonInsert) =>
    db.insert(lessons).values(value).onConflictDoUpdate({ target: lessons.conceptId, set: value }).run(),
  /** Partial patch — used by self-healing to set stale / version / prevSnapshot without
   *  rewriting the content columns (continuity B6). */
  update: (conceptId: string, patch: Partial<LessonInsert>) =>
    db.update(lessons).set(patch).where(eq(lessons.conceptId, conceptId)).run(),
};

/** The per-topic Course Canon (continuity B1). get/upsert only here; the
 *  merge/place orchestration lives in generation/canon.ts (next task). */
export const canonRepo = {
  get: (topicId: string) => db.select().from(courseCanon).where(eq(courseCanon.topicId, topicId)).get(),
  upsert: (value: CourseCanonInsert) =>
    db.insert(courseCanon).values(value).onConflictDoUpdate({ target: courseCanon.topicId, set: value }).run(),
};

/** Provider-sourced media assets, keyed (conceptId, mediaId) — cloned from widgetRepo.
 *  A resolve job (mediaJobs) moves a row through generating → ready/failed. */
export const mediaRepo = {
  get: (conceptId: string, mediaId: string) =>
    db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.conceptId, conceptId), eq(mediaAssets.mediaId, mediaId)))
      .get(),
  listByConcept: (conceptId: string) =>
    db.select().from(mediaAssets).where(eq(mediaAssets.conceptId, conceptId)).all(),
  upsert: (value: MediaAssetInsert) =>
    db
      .insert(mediaAssets)
      .values(value)
      .onConflictDoUpdate({ target: [mediaAssets.conceptId, mediaAssets.mediaId], set: value })
      .run(),
};

/** Web-search resources for a concept (web-search spec §6). REPLACE is the only write path:
 *  `replaceSet` deletes the concept's prior rows and inserts the new set (sequential — the proxy
 *  has no transaction seam yet, same as conceptRepo.deleteSubtree), so stale links never accumulate.
 *  `maxSetId` backs the "newest set wins" guard against a concurrent refresh. */
export const resourcesRepo = {
  listByConcept: (conceptId: string) =>
    db.select().from(resources).where(eq(resources.conceptId, conceptId)).all(),
  maxSetId: async (conceptId: string): Promise<number> => {
    const row = await db
      .select({ m: sql<number | null>`max(${resources.resourceSetId})` })
      .from(resources)
      .where(eq(resources.conceptId, conceptId))
      .get();
    return row?.m ?? 0;
  },
  replaceSet: async (conceptId: string, rows: ResourceInsert[]): Promise<void> => {
    await db.delete(resources).where(eq(resources.conceptId, conceptId)).run();
    if (rows.length) await db.insert(resources).values(rows).run();
  },
};

/** Built widget payloads, keyed (conceptId, widgetId). Upsert is the only write
 *  path — the builder job moves a row through generating → ready/failed. */
export const widgetRepo = {
  get: (conceptId: string, widgetId: string) =>
    db
      .select()
      .from(widgets)
      .where(and(eq(widgets.conceptId, conceptId), eq(widgets.widgetId, widgetId)))
      .get(),
  upsert: (value: WidgetInsert) =>
    db
      .insert(widgets)
      .values(value)
      .onConflictDoUpdate({ target: [widgets.conceptId, widgets.widgetId], set: value })
      .run(),
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
