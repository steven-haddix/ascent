// Spike 1 (JS half): does drizzle-orm/sqlite-proxy work against the SAME row
// shape our Rust `run_sql` returns (positional value arrays)?
//
// We use Node's built-in node:sqlite as a stand-in for the Rust executor —
// Drizzle can't tell the difference; it just receives `{ rows }`. This proves
// the rusqlite serialization contract end-to-end on the JS side, including the
// empty-`get()` case that breaks the tauri-plugin-sql (row-object) path, plus a
// relational `findFirst`.
//
// Run: node spikes/drizzle-proxy.mjs   (add --experimental-sqlite if needed)

import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { relations, eq } from "drizzle-orm";

// --- schema (mirrors Ascent's topic/concept shape) ---
const topics = sqliteTable("topics", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
});
const concepts = sqliteTable("concepts", {
  id: integer("id").primaryKey(),
  topicId: integer("topic_id").notNull(),
  title: text("title").notNull(),
});
const topicsRel = relations(topics, ({ many }) => ({ concepts: many(concepts) }));
const conceptsRel = relations(concepts, ({ one }) => ({
  topic: one(topics, { fields: [concepts.topicId], references: [topics.id] }),
}));
const schema = { topics, concepts, topicsRel, conceptsRel };

// --- raw SQLite (stands in for the Rust side) ---
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
  CREATE TABLE topics (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
  CREATE TABLE concepts (id INTEGER PRIMARY KEY, topic_id INTEGER NOT NULL, title TEXT NOT NULL);
  INSERT INTO topics (id, title) VALUES (1, 'Machine Learning');
  INSERT INTO concepts (id, topic_id, title) VALUES (1, 1, 'Transformers'), (2, 1, 'Embeddings');
`);

let calls = 0;
const db = drizzle(
  async (sql, params, method) => {
    calls++;
    const oneLine = sql.replace(/\s+/g, " ").slice(0, 72);
    console.log(`  proxy[${method}] ${oneLine}${sql.length > 72 ? "…" : ""}`);
    if (method === "run") {
      sqlite.prepare(sql).run(...params);
      return { rows: [] };
    }
    // node:sqlite returns row objects; map to positional arrays = what Rust returns
    const objs = sqlite.prepare(sql).all(...params);
    let rows = objs.map((o) => Object.values(o));
    if (method === "get") rows = rows[0]; // single row array, or undefined if no match
    return { rows };
  },
  { schema },
);

async function check(name, fn) {
  try {
    const v = await fn();
    console.log(`✅ ${name}: ${JSON.stringify(v)}`);
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log("— core: select all —");
await check("select all", () => db.select().from(concepts));
console.log("— core: get (hit) —");
await check("get hit", () => db.select().from(concepts).where(eq(concepts.id, 1)).get());
console.log("— core: get (MISS / empty — the bug case) —");
await check("get miss", () => db.select().from(concepts).where(eq(concepts.id, 999)).get());
console.log("— relational: findFirst (hit, with topic) —");
await check("findFirst hit", () =>
  db.query.concepts.findFirst({ where: eq(concepts.id, 1), with: { topic: true } }),
);
console.log("— relational: findFirst (MISS / empty) —");
await check("findFirst miss", () => db.query.concepts.findFirst({ where: eq(concepts.id, 999) }));

console.log(`\nproxy calls: ${calls}`);
console.log(
  process.exitCode
    ? "\nRESULT: FAIL — see ❌ above"
    : "\nRESULT: PASS — sqlite-proxy works with positional-array rows incl. empty get + relations",
);
