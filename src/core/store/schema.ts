// Drizzle schema — the local SQLite source of truth. Subject-agnostic.
import { sqliteTable, text, integer, real, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import type { Block, SuggestedFork, SuggestedLesson, LensId, ChatAttachment, RubricScores, TeachAnnotation, TeachGap, TopicBrief, WidgetStatus } from "../types";

/** A subject the learner is studying = one tree root. */
export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  rootConceptId: text("root_concept_id"),
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
  generatedAt: integer("generated_at").notNull(),
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
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("concept_links_src_tgt").on(t.sourceConceptId, t.targetConceptId)],
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
   *  spend to a use case; null for legacy getModel() call sites */
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
