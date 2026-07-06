// Chunk embeddings (knowledge-backbone K2) — the capability-gated vector arm of
// hybrid retrieval, mirroring semanticIndex.ts: sqlite-vec vec0 table via raw
// db_execute, FULLY DORMANT without an embeddings provider. Unlike the lesson
// index, the embedder identity is VERSIONED in chunk_embedding_meta: switching
// provider/model/dim triggers a full rebuild instead of querying stale vectors
// with a new model (the lesson index's latent flaw, fixed here first).
import { invoke } from "@tauri-apps/api/core";
import { getEmbedderFor, hasCapability } from "../ai/providers/registry";
import { providerRequest } from "../providerExecutor";
import { chunkRepo } from "../store/repositories";
import { dlog } from "../debug";

const BATCH = 16;

async function exec(sql: string, params: unknown[] = []): Promise<void> {
  await invoke("db_execute", { sql, params, method: "run" });
}
async function rows(sql: string, params: unknown[] = []): Promise<unknown[][]> {
  const r = await invoke<{ rows: unknown[][] }>("db_execute", { sql, params, method: "all" });
  return r.rows;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const embedder = getEmbedderFor("embed");
  if (!embedder) return [];
  const res = await providerRequest(embedder.provider.buildEmbed(texts, embedder.modelId));
  return embedder.provider.parseEmbed(JSON.parse(res.body));
}

/** Ensure the vec0 table + meta row match the ACTIVE embedder. Returns the ready
 *  dimensionality, or null when dormant. On an embedder switch, drops and rebuilds
 *  every ready document's vectors (logged; local corpora are small). */
async function ensureIndex(): Promise<number | null> {
  if (!hasCapability("embeddings")) return null;
  const embedder = getEmbedderFor("embed");
  if (!embedder) return null;

  await exec(
    `CREATE TABLE IF NOT EXISTS chunk_embedding_meta
     (id INTEGER PRIMARY KEY CHECK (id = 1), provider_id TEXT, model_id TEXT, dim INTEGER, built_at INTEGER)`,
  );
  const meta = await rows(`SELECT provider_id, model_id, dim FROM chunk_embedding_meta WHERE id = 1`);
  if (meta.length) {
    const [providerId, modelId, dim] = meta[0] as [string, string, number];
    if (providerId === embedder.provider.id && modelId === embedder.modelId) return dim;
    dlog("knowledge", `embedder changed (${providerId}/${modelId} → ${embedder.provider.id}/${embedder.modelId}) — rebuilding chunk vectors`);
    await exec(`DROP TABLE IF EXISTS chunk_embeddings`);
    await exec(`DELETE FROM chunk_embedding_meta`);
  }
  // Probe the dimensionality with a one-off embed, then persist the identity.
  const [probe] = await embedBatch(["dimension probe"]);
  if (!probe?.length) return null;
  await exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(chunk_id INTEGER PRIMARY KEY, embedding FLOAT[${probe.length}])`,
  );
  await exec(`INSERT INTO chunk_embedding_meta (id, provider_id, model_id, dim, built_at) VALUES (1, ?, ?, ?, ?)`, [
    embedder.provider.id,
    embedder.modelId,
    probe.length,
    Date.now(),
  ]);
  // Fresh index (first enable or post-switch): re-embed every ready document.
  void rebuildAll().catch((err) =>
    dlog("knowledge", "vector rebuild failed:", err instanceof Error ? err.message : String(err)),
  );
  return probe.length;
}

async function rebuildAll(): Promise<void> {
  for (const id of await allReadyDocumentIds()) await indexDocumentChunks(id);
}

async function allReadyDocumentIds(): Promise<number[]> {
  const r = await rows(`SELECT id FROM documents WHERE status = 'ready'`);
  return r.map((row) => row[0] as number);
}

/** Embed + store all chunks of a document. No-op when dormant; never throws. */
export async function indexDocumentChunks(documentId: number): Promise<void> {
  try {
    if ((await ensureIndex()) === null) return;
    const chunks = await chunkRepo.listByDocument(documentId);
    if (!chunks.length) return;
    await exec(`DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT id FROM document_chunks WHERE document_id = ?)`, [documentId]);
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const vecs = await embedBatch(batch.map((c) => c.text));
      for (let j = 0; j < batch.length; j++) {
        const vec = vecs[j];
        if (!vec?.length) continue;
        await exec(`INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)`, [
          batch[j].id,
          JSON.stringify(vec),
        ]);
      }
    }
    dlog("knowledge", `embedded ${chunks.length} chunks for doc ${documentId}`);
  } catch (err) {
    dlog("knowledge", "chunk embedding failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Remove a document's chunk vectors (before chunk replacement / document delete). */
export async function deleteDocumentChunkEmbeddings(documentId: number): Promise<void> {
  try {
    await exec(`DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT id FROM document_chunks WHERE document_id = ?)`, [documentId]);
  } catch {
    /* table may not exist yet — dormant is fine */
  }
}

/** KNN over chunk vectors: chunk ids best-first. [] when dormant or on any failure. */
export async function vectorSearchChunks(query: string, k: number): Promise<number[]> {
  try {
    if ((await ensureIndex()) === null) return [];
    const [vec] = await embedBatch([query]);
    if (!vec?.length) return [];
    const r = await rows(
      `SELECT chunk_id FROM chunk_embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
      [JSON.stringify(vec), k],
    );
    return r.map((row) => row[0] as number);
  } catch (err) {
    dlog("knowledge", "vector search failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}
