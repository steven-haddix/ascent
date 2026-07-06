// Drizzle schema — the local SQLite source of truth. Subject-agnostic.
import { sqliteTable, text, integer, real, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import type { License, Attribution } from "../media/types";
import type { Domain } from "../visuals/catalog";
import type { Block, SuggestedFork, SuggestedLesson, LensId, ChatAttachment, RubricScores, TeachAnnotation, TeachGap, TopicBrief, WidgetStatus, LessonDigest, LessonSnapshot, CanonSpine, CanonNotation, CanonMotif, CanonVoice, DocumentMeta, LearnerProfileSummary } from "../types";

/** A subject the learner is studying = one tree root. `draft` topics exist only
 *  during the creation flow (compose/interview) so attachments have a real topicId
 *  to bind to BEFORE the outline generates; the sidebar hides them, and a startup
 *  sweep deletes stale ones (an abandoned compose is not a topic). */
export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  rootConceptId: text("root_concept_id"),
  status: text("status", { enum: ["draft", "ready"] }).notNull().default("ready"),
  /** the AI intake brief that refined this topic (null for skipped/legacy topics) */
  brief: text("brief", { mode: "json" }).$type<TopicBrief>(),
  createdAt: integer("created_at").notNull(),
});

/** A concept node in a topic's tree. */
export const concepts = sqliteTable("concepts", {
  id: text("id").primaryKey(),
  topicId: text("topic_id")
    .notNull()
    .references(() => topics.id),
  parentId: text("parent_id"),
  title: text("title").notNull(),
  /** the outline's rationale for this concept — focus context for its lesson */
  summary: text("summary"),
  status: text("status", { enum: ["queued", "current", "visited", "complete"] })
    .notNull()
    .default("queued"),
  mastery: real("mastery").notNull().default(0),
  order: integer("order").notNull().default(0),
  state: text("state", { enum: ["outline", "generating", "ready"] })
    .notNull()
    .default("outline"),
  remedial: integer("remedial", { mode: "boolean" }).notNull().default(false),
  /** subject domains (multi-tag), classified by the LLM at outline/fork time — gives
   *  prompt-time visual hints, never a visual-tool whitelist. Empty = fall back to keyword inference. */
  domains: text("domains", { mode: "json" }).$type<Domain[]>().notNull().default(sql`'[]'`),
  createdAt: integer("created_at").notNull(),
});

/** The generated lesson body for a concept (one-to-one). */
export const lessons = sqliteTable("lessons", {
  conceptId: text("concept_id")
    .primaryKey()
    .references(() => concepts.id),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  blocks: text("blocks", { mode: "json" }).$type<Block[]>().notNull(),
  /** net-new sub-concepts to fork (renamed from suggested_branches) */
  suggestedForks: text("suggested_forks", { mode: "json" })
    .$type<SuggestedFork[]>()
    .notNull()
    .default(sql`'[]'`),
  /** links to concepts that already exist in this topic (resolved conceptIds) */
  suggestedLessons: text("suggested_lessons", { mode: "json" })
    .$type<SuggestedLesson[]>()
    .notNull()
    .default(sql`'[]'`),
  lenses: text("lenses", { mode: "json" }).$type<LensId[]>().notNull().default(sql`'[]'`),
  model: text("model"),
  // --- Continuity Engine (B2/B5/B6) ---
  /** compact structured summary of what this lesson established (post-stream digest); null until produced */
  digest: text("digest", { mode: "json" }).$type<LessonDigest>(),
  /** revision number; bumped by a self-heal rewrite (B6) */
  version: integer("version").notNull().default(1),
  /** when a self-heal last revised this lesson (null = never) */
  revisedAt: integer("revised_at"),
  /** why the last self-heal revised it (null = never) */
  revisedReason: text("revised_reason"),
  /** one-step-undo snapshot of the body before the last revision (null = none) */
  prevSnapshot: text("prev_snapshot", { mode: "json" }).$type<LessonSnapshot>(),
  /** learner state changed materially → may want re-tailoring (B5) */
  stale: integer("stale", { mode: "boolean" }).notNull().default(false),
  generatedAt: integer("generated_at").notNull(),
});

/** Durable checkpoint for an interrupted lesson generation. Kept separate from
 * `lessons` so a failed regeneration never overwrites the last good lesson. */
export const lessonDrafts = sqliteTable("lesson_drafts", {
  conceptId: text("concept_id")
    .primaryKey()
    .references(() => concepts.id),
  generationId: text("generation_id").notNull(),
  status: text("status", { enum: ["streaming", "paused", "failed"] })
    .notNull()
    .default("streaming"),
  subtitle: text("subtitle"),
  blocks: text("blocks", { mode: "json" }).$type<Block[]>().notNull().default(sql`'[]'`),
  /** The first unsafe/incomplete block, retained only as context for recovery. */
  discardedBlock: text("discarded_block", { mode: "json" }).$type<Block>(),
  /** Exact original prompt so continuation does not have to reconstruct context. */
  prompt: text("prompt"),
  failureKind: text("failure_kind", {
    enum: ["manual", "timeout", "truncated", "validation", "provider", "unknown"],
  }),
  error: text("error"),
  /** Sanitized, model-actionable feedback derived from `error`. */
  recoveryHint: text("recovery_hint"),
  finishReason: text("finish_reason"),
  attempts: integer("attempts").notNull().default(0),
  model: text("model"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** The living "course memory" for a topic (one row per topic): shared spine,
 *  notation registry, motifs, voice charter, and cross-tree prerequisite graph
 *  every lesson conforms to. Seeded after intake+outline, then enriched by each
 *  lesson's digest (B1). Write-backs happen AFTER a lesson upsert, never in-stream. */
export const courseCanon = sqliteTable("course_canon", {
  topicId: text("topic_id")
    .primaryKey()
    .references(() => topics.id),
  spine: text("spine", { mode: "json" }).$type<CanonSpine>().notNull().default(sql`'{"arc":"","order":[]}'`),
  notation: text("notation", { mode: "json" }).$type<CanonNotation[]>().notNull().default(sql`'[]'`),
  motifs: text("motifs", { mode: "json" }).$type<CanonMotif[]>().notNull().default(sql`'[]'`),
  voice: text("voice", { mode: "json" }).$type<CanonVoice>().notNull().default(sql`'{"tone":"","depth":"","pacing":""}'`),
  /** prerequisite graph: conceptId → conceptIds it builds on (cross-tree "builds on") */
  prereqs: text("prereqs", { mode: "json" }).$type<Record<string, string[]>>().notNull().default(sql`'{}'`),
  version: integer("version").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

/** A directed cross-link between two concepts in the same topic — "this concept
 *  relates to that one". Created eagerly when a lesson recommends an existing
 *  concept (a Link), and when a fork resolves to an existing concept. Feeds the
 *  future graph view + backlinks. Deduped on (source, target). */
export const conceptLinks = sqliteTable(
  "concept_links",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id),
    sourceConceptId: text("source_concept_id")
      .notNull()
      .references(() => concepts.id),
    targetConceptId: text("target_concept_id")
      .notNull()
      .references(() => concepts.id),
    /** the model's one-line "why these relate", from the source's point of view */
    reason: text("reason"),
    /** edge type: a generic link, a canon "builds on" prerequisite, or a "leads to"
     *  continuation (B8) — lets the graph view distinguish continuity edges from links. */
    relation: text("relation", { enum: ["link", "builds-on", "leads-to"] })
      .notNull()
      .default("link"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("concept_links_src_tgt").on(t.sourceConceptId, t.targetConceptId, t.relation)],
);

/** A learner's own highlight over a concept's lesson prose. Anchored by quote +
 *  context (exact text + surrounding prefix/suffix) so it survives blocks shifting;
 *  `gloss` is filled on demand by "Define inline". Dedup by anchor is done in the
 *  hook (not a DB constraint) so an insert can return an existing row's id. */
export const highlights = sqliteTable("highlights", {
  id: text("id").primaryKey(),
  conceptId: text("concept_id")
    .notNull()
    .references(() => concepts.id),
  /** the selected text, verbatim */
  exact: text("exact").notNull(),
  /** up to ~32 chars of block text immediately before the selection */
  prefix: text("prefix").notNull().default(""),
  /** up to ~32 chars of block text immediately after the selection */
  suffix: text("suffix").notNull().default(""),
  /** one-line definition, populated lazily by "Define inline" */
  gloss: text("gloss"),
  createdAt: integer("created_at").notNull(),
});

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  conceptId: text("concept_id")
    .notNull()
    .references(() => concepts.id),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const chatTurns = sqliteTable("chat_turns", {
  id: text("id").primaryKey(),
  conceptId: text("concept_id")
    .notNull()
    .references(() => concepts.id),
  role: text("role", { enum: ["user", "ai"] }).notNull(),
  text: text("text").notNull(),
  attachments: text("attachments", { mode: "json" }).$type<ChatAttachment[]>(),
  createdAt: integer("created_at").notNull(),
});

/** A Feynman teach-back attempt and its structured grade (one concept, many attempts). */
export const teachAttempts = sqliteTable("teach_attempts", {
  id: text("id").primaryKey(),
  conceptId: text("concept_id")
    .notNull()
    .references(() => concepts.id),
  audience: text("audience").notNull(),
  /** the learner's explanation, verbatim */
  text: text("text").notNull(),
  rubric: text("rubric", { mode: "json" }).$type<RubricScores>().notNull(),
  verdict: text("verdict").notNull(),
  annotations: text("annotations", { mode: "json" }).$type<TeachAnnotation[]>().notNull().default(sql`'[]'`),
  gaps: text("gaps", { mode: "json" }).$type<TeachGap[]>().notNull().default(sql`'[]'`),
  /** how much this attempt moved the concept's mastery (computed in-app) */
  masteryDelta: real("mastery_delta").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

/** A built interactive widget — the payload a lesson's `widget` placeholder block
 *  points to. Deliberately NOT inside lesson.blocks: the builder job finishing
 *  must never race the still-streaming lesson's final upsert. `source` is the JSX
 *  the model wrote (kept for revise/debug); `compiled` is the sucrase output the
 *  sandboxed iframe actually runs. */
export const widgets = sqliteTable(
  "widgets",
  {
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id),
    /** normalized slug from the placeholder block, unique within the concept */
    widgetId: text("widget_id").notNull(),
    title: text("title").notNull(),
    spec: text("spec").notNull(),
    status: text("status", { enum: ["generating", "ready", "failed"] })
      .notNull()
      .$type<WidgetStatus>()
      .default("generating"),
    source: text("source"),
    compiled: text("compiled"),
    /** last compile/render error — set while retrying and on `failed` */
    error: text("error"),
    /** generation attempts so far (compile + render failures both count) */
    attempts: integer("attempts").notNull().default(0),
    /** model id that produced `source` */
    model: text("model"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.conceptId, t.widgetId] })],
);

/** One AI round-trip's token usage + a cost snapshot. Append-only; the Settings
 *  Usage view aggregates over it. `provider` is the route id (e.g. "anthropic");
 *  tokens are ground truth; `costUsd` is computed at write time from that route's
 *  pricing (null when the rate is unknown), and `costSource` records how. */
export const usageEvents = sqliteTable("usage_events", {
  id: text("id").primaryKey(),
  /** route/provider id the request went through (routes.ts) */
  provider: text("provider").notNull(),
  /** AI task id (tasks.ts) when the call came through getModelFor — attributes
   *  spend to a use case; null only for legacy ledger rows */
  task: text("task"),
  /** model id as sent to the provider (may be namespaced through a gateway) */
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  /** USD cost snapshot at write time; null when the route can't price this model */
  costUsd: real("cost_usd"),
  costSource: text("cost_source", { enum: ["reported", "rates", "unknown"] }).notNull(),
  createdAt: integer("created_at").notNull(),
});

/** A provider-sourced media asset (image v1) that a `media`/`figure` placeholder points
 *  to. Same race-avoidance rationale as `widgets`: the resolve job must never collide with
 *  the streaming lesson's final upsert, so it lives in its own table keyed (conceptId,
 *  mediaId). Bytes are cached on disk (localPath); the row is the index + license/attribution. */
export const mediaAssets = sqliteTable(
  "media_assets",
  {
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id),
    mediaId: text("media_id").notNull(),
    kind: text("kind").notNull().default("image"),
    providerId: text("provider_id"),
    query: text("query").notNull(),
    status: text("status", { enum: ["generating", "ready", "failed"] })
      .notNull()
      .default("generating"),
    localPath: text("local_path"),
    width: integer("width"),
    height: integer("height"),
    license: text("license", { mode: "json" }).$type<License>(),
    attribution: text("attribution", { mode: "json" }).$type<Attribution>(),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.conceptId, t.mediaId] })],
);

/** Web-search resources for a concept's "Continue learning" panel (web-search spec §6). REPLACE
 *  lifecycle: a successful search deletes the concept's prior rows and inserts the new set, so no
 *  stale links accumulate. `resourceSetId` (monotonic per concept) enforces "newest set wins" against
 *  a concurrent refresh; `queryHash` invalidates the cache when the concept (and thus query) changes.
 *  Keyed (conceptId, url) — valid BECAUSE the policy is replace (a recurring URL across generations
 *  would only collide under an archive policy, which is a deliberate future option). */
export const resources = sqliteTable(
  "resources",
  {
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id),
    url: text("url").notNull(),
    title: text("title").notNull(),
    snippet: text("snippet"),
    source: text("source"),
    kind: text("kind", { enum: ["web", "paper", "video", "blog", "docs"] }).notNull().default("web"),
    publishedAt: text("published_at"),
    score: real("score"),
    providerId: text("provider_id"),
    query: text("query").notNull(),
    queryHash: text("query_hash").notNull(),
    resourceSetId: integer("resource_set_id").notNull(),
    status: text("status", { enum: ["generating", "ready", "failed"] }).notNull().default("ready"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.conceptId, t.url] })],
);

/** A content-addressed knowledge document — the PHYSICAL artifact (bytes + extraction
 *  state) of the source library (knowledge-backbone plan §4). Deduped by contentHash:
 *  the same paper saved in five topics is ONE document with five `sources` bindings.
 *  Integer PK on purpose — chunks join FTS5 external-content tables on rowid.
 *  `status` is phased so a crash/retry resumes at the failed phase (the startup sweep
 *  re-enqueues non-terminal rows) and `ready` always means fully indexed. */
export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contentHash: text("content_hash").notNull().unique(),
  /** canonical http(s) URL for web-found documents; null for uploads */
  url: text("url"),
  /** durable blob path under app_data_dir/library/blobs/<contentHash> */
  localPath: text("local_path"),
  mime: text("mime"),
  byteSize: integer("byte_size"),
  title: text("title").notNull(),
  kind: text("kind", { enum: ["web", "paper", "video", "blog", "docs", "pdf", "resume", "notes"] })
    .notNull()
    .default("web"),
  status: text("status", {
    enum: ["queued", "fetching", "extracting", "chunking", "indexing", "ready", "failed"],
  })
    .notNull()
    .default("queued"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: integer("last_attempt_at"),
  /** extractor that produced the current chunks (e.g. "local-pdf"); null until extracted */
  extractorId: text("extractor_id"),
  /** bumped on re-extract; chunks and lesson_source_refs carry it */
  extractionVersion: integer("extraction_version").notNull().default(0),
  meta: text("meta", { mode: "json" }).$type<DocumentMeta>().notNull().default(sql`'{}'`),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** A binding of a document into a context — what the Library UI lists. `scope`
 *  "topic" ties it to one topic's library; "profile" is the global learner-docs
 *  scope (topicId null). Each binding keeps its own discovery provenance. The
 *  unique index covers the topic scope; the profile-scope NULL case (SQLite treats
 *  NULLs as distinct) is guarded in the repo's find-or-create. */
export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id),
    scope: text("scope", { enum: ["topic", "profile"] }).notNull(),
    topicId: text("topic_id").references(() => topics.id),
    origin: text("origin", { enum: ["search", "upload", "chat"] }).notNull(),
    /** how this document functions IN THIS CONTEXT (topic-creation design):
     *  syllabus = shapes the tree's structure; ground-truth = content anchor,
     *  citation-priority; reference = normal retrieval. Heuristic-guessed at
     *  add-time (guessRole), user-editable in the Library. */
    role: text("role", { enum: ["syllabus", "ground-truth", "reference"] })
      .notNull()
      .default("reference"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    /** which concept's search surfaced it (null for uploads/profile docs) */
    addedFromConceptId: text("added_from_concept_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("sources_doc_scope_topic").on(t.documentId, t.scope, t.topicId)],
);

/** Extraction output — the retrieval unit. Integer PK: FTS5 external-content
 *  tables join on rowid (content_rowid='id'); the chunk_fts virtual table and its
 *  sync triggers live in the migration SQL (drizzle can't model virtual tables). */
export const documentChunks = sqliteTable("document_chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id")
    .notNull()
    .references(() => documents.id),
  seq: integer("seq").notNull(),
  text: text("text").notNull(),
  /** citation locator: "p.4" for PDFs, a heading path for HTML/markdown */
  locator: text("locator"),
  extractionVersion: integer("extraction_version").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** What a lesson's generation ACTUALLY retrieved from the library, snapshotted
 *  post-stream — so "Sources used" means used (not "everything in the library"),
 *  a re-extraction can't silently rewrite an old lesson's citations, and the
 *  Library can show backlinks. REPLACE-per-concept on each generation. */
export const lessonSourceRefs = sqliteTable(
  "lesson_source_refs",
  {
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id),
    /** chunk ids injected, best-rank first */
    chunkIds: text("chunk_ids", { mode: "json" }).$type<number[]>().notNull().default(sql`'[]'`),
    locators: text("locators", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    /** best retrieval rank this document achieved for the lesson (0 = top) */
    rank: integer("rank").notNull(),
    extractionVersion: integer("extraction_version").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.conceptId, t.documentId] })],
);

/** The global learner profile (one row, id "default") distilled from uploaded
 *  background docs (resume, bio) — who the learner is, independent of any topic. */
export const learnerProfile = sqliteTable("learner_profile", {
  id: text("id").primaryKey(),
  summary: text("summary", { mode: "json" }).$type<LearnerProfileSummary>().notNull(),
  /** the source bindings this summary was distilled from */
  sourceIds: text("source_ids", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  version: integer("version").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

export const topicsRelations = relations(topics, ({ many }) => ({ concepts: many(concepts) }));
export const conceptsRelations = relations(concepts, ({ one, many }) => ({
  topic: one(topics, { fields: [concepts.topicId], references: [topics.id] }),
  lesson: one(lessons, { fields: [concepts.id], references: [lessons.conceptId] }),
  notes: many(notes),
  chatTurns: many(chatTurns),
  teachAttempts: many(teachAttempts),
  highlights: many(highlights),
  outgoingLinks: many(conceptLinks, { relationName: "source" }),
  incomingLinks: many(conceptLinks, { relationName: "target" }),
}));
export const highlightsRelations = relations(highlights, ({ one }) => ({
  concept: one(concepts, { fields: [highlights.conceptId], references: [concepts.id] }),
}));
export const conceptLinksRelations = relations(conceptLinks, ({ one }) => ({
  topic: one(topics, { fields: [conceptLinks.topicId], references: [topics.id] }),
  source: one(concepts, {
    fields: [conceptLinks.sourceConceptId],
    references: [concepts.id],
    relationName: "source",
  }),
  target: one(concepts, {
    fields: [conceptLinks.targetConceptId],
    references: [concepts.id],
    relationName: "target",
  }),
}));
export const lessonsRelations = relations(lessons, ({ one }) => ({
  concept: one(concepts, { fields: [lessons.conceptId], references: [concepts.id] }),
}));
export const courseCanonRelations = relations(courseCanon, ({ one }) => ({
  topic: one(topics, { fields: [courseCanon.topicId], references: [topics.id] }),
}));
export const notesRelations = relations(notes, ({ one }) => ({
  concept: one(concepts, { fields: [notes.conceptId], references: [concepts.id] }),
}));
export const chatTurnsRelations = relations(chatTurns, ({ one }) => ({
  concept: one(concepts, { fields: [chatTurns.conceptId], references: [concepts.id] }),
}));
export const teachAttemptsRelations = relations(teachAttempts, ({ one }) => ({
  concept: one(concepts, { fields: [teachAttempts.conceptId], references: [concepts.id] }),
}));
export const widgetsRelations = relations(widgets, ({ one }) => ({
  concept: one(concepts, { fields: [widgets.conceptId], references: [concepts.id] }),
}));
export const mediaAssetsRelations = relations(mediaAssets, ({ one }) => ({
  concept: one(concepts, { fields: [mediaAssets.conceptId], references: [concepts.id] }),
}));
