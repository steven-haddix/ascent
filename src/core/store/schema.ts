// Drizzle schema — the local SQLite source of truth. Subject-agnostic.
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import type { Block, SuggestedBranch, LensId, ChatAttachment } from "../types";

/** A subject the learner is studying = one tree root. */
export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  rootConceptId: text("root_concept_id"),
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

export const topicsRelations = relations(topics, ({ many }) => ({ concepts: many(concepts) }));
export const conceptsRelations = relations(concepts, ({ one, many }) => ({
  topic: one(topics, { fields: [concepts.topicId], references: [topics.id] }),
  lesson: one(lessons, { fields: [concepts.id], references: [lessons.conceptId] }),
  notes: many(notes),
  chatTurns: many(chatTurns),
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
