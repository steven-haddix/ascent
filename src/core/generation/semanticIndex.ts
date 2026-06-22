// SemanticIndex (Continuity B7) — capability-gated cross-tree retrieval. When an embeddings
// provider is configured, each lesson's digest is embedded into a sqlite-vec virtual table;
// at generation time the top-k most-related already-generated lessons (across the WHOLE tree,
// not just neighbors) are surfaced so a lesson can reference what it genuinely relates to.
//
// FULLY DORMANT when no embeddings provider is enabled (the default): cohesion falls back to
// the canon prereq graph — the always-on floor. sqlite-vec is accessed via raw db_execute
// (drizzle doesn't model virtual tables); the extension is registered in db::open (Rust).
// Every path is gated on hasCapability("embeddings") + try/caught so it NEVER breaks
// generation. Verify live: enable an embeddings provider (cloud key or local Ollama) in
// Settings → Sources, then generate a few lessons and confirm cross-tree references appear.
import { invoke } from "@tauri-apps/api/core";
import { getEmbedderFor, hasCapability } from "../ai/providers/registry";
import { providerRequest } from "../providerExecutor";
import { lessonRepo } from "../store/repositories";
import type { LessonDigest } from "../types";
import { dlog } from "../debug";

let ensuredDim: number | null = null;

async function exec(sql: string, params: unknown[] = []): Promise<void> {
  await invoke("db_execute", { sql, params, method: "run" });
}
async function rows(sql: string, params: unknown[] = []): Promise<unknown[][]> {
  const r = await invoke<{ rows: unknown[][] }>("db_execute", { sql, params, method: "all" });
  return r.rows;
}

/** Lazily create the vec0 virtual table, sized to the active embedder's dimensionality. */
async function ensureTable(dim: number): Promise<void> {
  if (ensuredDim === dim) return;
  await exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS lesson_embeddings USING vec0(concept_id TEXT PRIMARY KEY, embedding FLOAT[${dim}])`,
  );
  ensuredDim = dim;
}

function digestText(d: LessonDigest): string {
  return [d.recap, ...d.motifs, ...d.notation.map((n) => `${n.symbol}: ${n.means}`)].filter(Boolean).join(" ");
}

async function embed(text: string): Promise<number[] | null> {
  const embedder = getEmbedderFor("embed");
  if (!embedder) return null;
  const res = await providerRequest(embedder.provider.buildEmbed([text], embedder.modelId));
  const vecs = embedder.provider.parseEmbed(JSON.parse(res.body));
  return vecs[0] ?? null;
}

/** Embed + store a finished lesson's digest. No-op without an embeddings capability. */
export async function indexDigest(conceptId: string, digest: LessonDigest): Promise<void> {
  if (!hasCapability("embeddings")) return;
  try {
    const vec = await embed(digestText(digest));
    if (!vec?.length) return;
    await ensureTable(vec.length);
    await exec(`DELETE FROM lesson_embeddings WHERE concept_id = ?`, [conceptId]);
    await exec(`INSERT INTO lesson_embeddings (concept_id, embedding) VALUES (?, ?)`, [
      conceptId,
      JSON.stringify(vec),
    ]);
    dlog("semindex", "indexed", conceptId);
  } catch (err) {
    dlog("semindex", "index failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Top-k already-generated lessons most related to `queryText` (a concept's title+summary),
 *  across the whole tree. Returns those that still have a digest; [] when dormant. */
export async function retrieveRelated(
  conceptId: string,
  queryText: string,
  k = 4,
): Promise<{ conceptId: string; title: string; digest: LessonDigest }[]> {
  if (!hasCapability("embeddings")) return [];
  try {
    const vec = await embed(queryText);
    if (!vec?.length) return [];
    await ensureTable(vec.length);
    // KNN: retrieve k+1 then drop self in JS (sqlite-vec restricts extra WHERE clauses).
    const matched = await rows(
      `SELECT concept_id FROM lesson_embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
      [JSON.stringify(vec), k + 1],
    );
    const out: { conceptId: string; title: string; digest: LessonDigest }[] = [];
    for (const row of matched) {
      const id = row[0] as string;
      if (id === conceptId) continue;
      const lesson = await lessonRepo.get(id);
      if (lesson?.digest) out.push({ conceptId: id, title: lesson.title, digest: lesson.digest });
      if (out.length >= k) break;
    }
    return out;
  } catch (err) {
    dlog("semindex", "retrieve failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}
