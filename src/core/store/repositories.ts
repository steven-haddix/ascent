// Typed repositories — the ONLY way the rest of the app touches the store.
// Components/services never import drizzle directly; this seam is what lets us
// later swap in a reactive layer (TanStack DB) or a sync engine without UI churn.
import { asc, eq } from "drizzle-orm";
import { db } from "./client";
import { topics, concepts, lessons, notes, chatTurns, teachAttempts } from "./schema";

export type TopicInsert = typeof topics.$inferInsert;
export type TopicRow = typeof topics.$inferSelect;
export type ConceptInsert = typeof concepts.$inferInsert;
export type ConceptRow = typeof concepts.$inferSelect;
export type LessonInsert = typeof lessons.$inferInsert;
export type NoteInsert = typeof notes.$inferInsert;
export type ChatTurnInsert = typeof chatTurns.$inferInsert;
export type TeachAttemptInsert = typeof teachAttempts.$inferInsert;
export type TeachAttemptRow = typeof teachAttempts.$inferSelect;

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
};

export const lessonRepo = {
  get: (conceptId: string) => db.select().from(lessons).where(eq(lessons.conceptId, conceptId)).get(),
  upsert: (value: LessonInsert) =>
    db.insert(lessons).values(value).onConflictDoUpdate({ target: lessons.conceptId, set: value }).run(),
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
