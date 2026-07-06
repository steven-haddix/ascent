// Typed repositories — the ONLY way the rest of the app touches the store.
// Components/services never import drizzle directly; this seam is what lets us
// later swap in a reactive layer (TanStack DB) or a sync engine without UI churn.
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "./client";
import { topics, concepts, conceptLinks, lessons, lessonDrafts, notes, chatTurns, teachAttempts, highlights, usageEvents, widgets, courseCanon, mediaAssets, resources, documents, sources, documentChunks, lessonSourceRefs, learnerProfile } from "./schema";

export type TopicInsert = typeof topics.$inferInsert;
export type TopicRow = typeof topics.$inferSelect;
export type ConceptInsert = typeof concepts.$inferInsert;
export type ConceptRow = typeof concepts.$inferSelect;
export type LessonInsert = typeof lessons.$inferInsert;
export type LessonRow = typeof lessons.$inferSelect;
export type LessonDraftInsert = typeof lessonDrafts.$inferInsert;
export type LessonDraftRow = typeof lessonDrafts.$inferSelect;
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
  /** Sidebar topics — drafts (mid-creation) are hidden. */
  listReady: () =>
    db.select().from(topics).where(eq(topics.status, "ready")).orderBy(asc(topics.createdAt)).all(),
  listDrafts: () => db.select().from(topics).where(eq(topics.status, "draft")).all(),
  get: (id: string) => db.select().from(topics).where(eq(topics.id, id)).get(),
  create: (value: TopicInsert) => db.insert(topics).values(value).run(),
  update: (id: string, patch: Partial<TopicInsert>) =>
    db.update(topics).set(patch).where(eq(topics.id, id)).run(),
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
    await db.delete(lessonSourceRefs).where(inArray(lessonSourceRefs.conceptId, ids)).run();
    await db.delete(lessonDrafts).where(inArray(lessonDrafts.conceptId, ids)).run();
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

export const lessonDraftRepo = {
  get: (conceptId: string) =>
    db.select().from(lessonDrafts).where(eq(lessonDrafts.conceptId, conceptId)).get(),
  upsert: (value: LessonDraftInsert) =>
    db
      .insert(lessonDrafts)
      .values(value)
      .onConflictDoUpdate({ target: lessonDrafts.conceptId, set: value })
      .run(),
  update: (conceptId: string, patch: Partial<LessonDraftInsert>) =>
    db.update(lessonDrafts).set(patch).where(eq(lessonDrafts.conceptId, conceptId)).run(),
  remove: (conceptId: string) =>
    db.delete(lessonDrafts).where(eq(lessonDrafts.conceptId, conceptId)).run(),
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

// --- Knowledge library (knowledge-backbone plan §4/§5) ---

export type DocumentInsert = typeof documents.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;
export type SourceInsert = typeof sources.$inferInsert;
export type SourceRow = typeof sources.$inferSelect;
export type DocumentChunkInsert = typeof documentChunks.$inferInsert;
export type DocumentChunkRow = typeof documentChunks.$inferSelect;
export type LessonSourceRefInsert = typeof lessonSourceRefs.$inferInsert;
export type LessonSourceRefRow = typeof lessonSourceRefs.$inferSelect;
export type LearnerProfileRow = typeof learnerProfile.$inferSelect;

/** A source binding joined with its document — what the Library UI renders. */
export interface LibraryEntry {
  source: SourceRow;
  document: DocumentRow;
}

/** Content-addressed physical documents. `create` resolves by the unique
 *  contentHash after insert (no RETURNING dependency on the proxy driver). */
export const documentRepo = {
  get: (id: number) => db.select().from(documents).where(eq(documents.id, id)).get(),
  getByHash: (contentHash: string) =>
    db.select().from(documents).where(eq(documents.contentHash, contentHash)).get(),
  create: async (value: DocumentInsert): Promise<DocumentRow> => {
    await db.insert(documents).values(value).run();
    const row = await documentRepo.getByHash(value.contentHash);
    if (!row) throw new Error("document insert did not persist");
    return row;
  },
  update: (id: number, patch: Partial<DocumentInsert>) =>
    db.update(documents).set(patch).where(eq(documents.id, id)).run(),
  /** Non-terminal rows for the startup sweep (stuck mid-phase after a crash). */
  nonTerminal: () =>
    db
      .select()
      .from(documents)
      .where(sql`${documents.status} NOT IN ('ready', 'failed')`)
      .all(),
  delete: (id: number) => db.delete(documents).where(eq(documents.id, id)).run(),
};

/** Bindings of documents into topic/profile scopes. The profile-scope duplicate
 *  guard lives in findBinding (SQLite unique indexes treat NULLs as distinct). */
export const sourceRepo = {
  get: (id: string) => db.select().from(sources).where(eq(sources.id, id)).get(),
  findBinding: (documentId: number, scope: "topic" | "profile", topicId: string | null) =>
    db
      .select()
      .from(sources)
      .where(
        and(
          eq(sources.documentId, documentId),
          eq(sources.scope, scope),
          topicId === null ? sql`${sources.topicId} IS NULL` : eq(sources.topicId, topicId),
        ),
      )
      .get(),
  create: (value: SourceInsert) => db.insert(sources).values(value).run(),
  listByTopic: async (topicId: string): Promise<LibraryEntry[]> => {
    const rows = await db
      .select({ source: sources, document: documents })
      .from(sources)
      .innerJoin(documents, eq(sources.documentId, documents.id))
      .where(and(eq(sources.scope, "topic"), eq(sources.topicId, topicId)))
      .orderBy(asc(sources.createdAt))
      .all();
    return rows;
  },
  listProfile: async (): Promise<LibraryEntry[]> => {
    const rows = await db
      .select({ source: sources, document: documents })
      .from(sources)
      .innerJoin(documents, eq(sources.documentId, documents.id))
      .where(eq(sources.scope, "profile"))
      .orderBy(asc(sources.createdAt))
      .all();
    return rows;
  },
  setPinned: (id: string, pinned: boolean) =>
    db.update(sources).set({ pinned }).where(eq(sources.id, id)).run(),
  setRole: (id: string, role: "syllabus" | "ground-truth" | "reference") =>
    db.update(sources).set({ role }).where(eq(sources.id, id)).run(),
  delete: (id: string) => db.delete(sources).where(eq(sources.id, id)).run(),
  countForDocument: async (documentId: number): Promise<number> => {
    const row = await db
      .select({ n: sql<number>`count(*)` })
      .from(sources)
      .where(eq(sources.documentId, documentId))
      .get();
    return row?.n ?? 0;
  },
  /** documentIds retrievable for a topic: its topic bindings + all profile bindings. */
  documentIdsInScope: async (
    topicId: string,
  ): Promise<{ id: number; pinned: boolean; origin: string; role: string }[]> => {
    const rows = await db
      .select({ id: sources.documentId, pinned: sources.pinned, origin: sources.origin, role: sources.role })
      .from(sources)
      .where(or(and(eq(sources.scope, "topic"), eq(sources.topicId, topicId)), eq(sources.scope, "profile")))
      .all();
    // A document bound more than once keeps its strongest signals (pinned wins,
    // upload wins, ground-truth wins over reference).
    const byId = new Map<number, { id: number; pinned: boolean; origin: string; role: string }>();
    for (const r of rows) {
      const prev = byId.get(r.id);
      if (!prev) byId.set(r.id, r);
      else
        byId.set(r.id, {
          id: r.id,
          pinned: prev.pinned || r.pinned,
          origin: prev.origin === "upload" ? prev.origin : r.origin,
          role: prev.role === "ground-truth" || r.role === "ground-truth" ? "ground-truth" : prev.role,
        });
    }
    return [...byId.values()];
  },
};

/** Extraction chunks. REPLACE-per-document: the FTS triggers (migration 0014)
 *  keep chunk_fts in sync on every delete/insert, so no manual FTS writes here. */
export const chunkRepo = {
  listByDocument: (documentId: number) =>
    db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId))
      .orderBy(asc(documentChunks.seq))
      .all(),
  getByIds: (ids: number[]) =>
    ids.length ? db.select().from(documentChunks).where(inArray(documentChunks.id, ids)).all() : Promise.resolve([]),
  replaceForDocument: async (documentId: number, rows: Omit<DocumentChunkInsert, "id">[]): Promise<void> => {
    await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId)).run();
    // Chunked inserts: a long PDF can exceed the statement's bind-parameter budget in one VALUES.
    for (let i = 0; i < rows.length; i += 50) {
      await db.insert(documentChunks).values(rows.slice(i, i + 50)).run();
    }
  },
  deleteForDocument: (documentId: number) =>
    db.delete(documentChunks).where(eq(documentChunks.documentId, documentId)).run(),
};

/** Post-generation snapshot of what a lesson actually retrieved (plan §4). */
export const sourceRefRepo = {
  listByConcept: (conceptId: string) =>
    db.select().from(lessonSourceRefs).where(eq(lessonSourceRefs.conceptId, conceptId)).all(),
  listByDocument: (documentId: number) =>
    db.select().from(lessonSourceRefs).where(eq(lessonSourceRefs.documentId, documentId)).all(),
  replaceForConcept: async (conceptId: string, rows: LessonSourceRefInsert[]): Promise<void> => {
    await db.delete(lessonSourceRefs).where(eq(lessonSourceRefs.conceptId, conceptId)).run();
    if (rows.length) await db.insert(lessonSourceRefs).values(rows).run();
  },
};

/** The single global learner profile row (id "default"). */
export const profileRepo = {
  get: () => db.select().from(learnerProfile).where(eq(learnerProfile.id, "default")).get(),
  upsert: (value: Omit<typeof learnerProfile.$inferInsert, "id">) =>
    db
      .insert(learnerProfile)
      .values({ ...value, id: "default" })
      .onConflictDoUpdate({ target: learnerProfile.id, set: value })
      .run(),
};
