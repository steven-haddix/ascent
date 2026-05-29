// Drizzle schema — the local SQLite source of truth. Subject-agnostic.
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import type { Block, SuggestedBranch, LensId, ChatAttachment, RubricScores, TeachAnnotation, TeachGap, TopicBrief } from "../types";

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
  suggestedBranches: text("suggested_branches", { mode: "json" })
    .$type<SuggestedBranch[]>()
    .notNull()
    .default(sql`'[]'`),
  lenses: text("lenses", { mode: "json" }).$type<LensId[]>().notNull().default(sql`'[]'`),
  model: text("model"),
  generatedAt: integer("generated_at").notNull(),
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

/** One AI round-trip's token usage + a cost snapshot. Append-only; the Settings
 *  Usage view aggregates over it. `provider` is the route id (e.g. "anthropic");
 *  tokens are ground truth; `costUsd` is computed at write time from that route's
 *  pricing (null when the rate is unknown), and `costSource` records how. */
export const usageEvents = sqliteTable("usage_events", {
  id: text("id").primaryKey(),
  /** route/provider id the request went through (routes.ts) */
  provider: text("provider").notNull(),
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
