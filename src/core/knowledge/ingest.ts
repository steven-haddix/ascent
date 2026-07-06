// KnowledgeService — ingestion (knowledge-backbone plan §5). The durable queue IS
// the phased documents.status column: save-actions fetch bytes first (content
// addressing needs bytes before identity), create/find the document + binding, then
// walk extracting → chunking → indexing → ready in a background job. A crash leaves
// an honest mid-phase status; sweepLibrary() (app startup) re-enqueues non-terminal
// rows, resuming at the stalled phase — bytes are already on disk, so nothing
// re-fetches. Deliberately NOT the session-local widget/media job pattern, which
// only recovers on re-mount. Single-process app: an in-memory in-flight map dedupes
// within the session; `attempts` caps retries across sessions.
import { derror, dlog } from "../debug";
import { queryClient } from "../store/queryClient";
import {
  chunkRepo,
  documentRepo,
  sourceRefRepo,
  sourceRepo,
  type DocumentRow,
} from "../store/repositories";
import { libraryDeleteBlob, libraryFetch, libraryReadBlob, libraryStoreBytes } from "./blobs";
import { chunkSections } from "./chunk";
import { deleteDocumentChunkEmbeddings, indexDocumentChunks } from "./embeddings";
import { extractorFor } from "./extract/registry";
import { guessRole, type DocumentKind, type SourceRole } from "./types";

const MAX_ATTEMPTS = 3;
/** a non-terminal row younger than this is assumed owned by a live job, not stale */
const SWEEP_STALE_MS = 30_000;

const inflight = new Map<number, Promise<void>>();

function publish(): void {
  void queryClient.invalidateQueries({ queryKey: ["library"] });
}

async function setStatus(id: number, patch: Parameters<typeof documentRepo.update>[1]): Promise<void> {
  await documentRepo.update(id, { ...patch, updatedAt: Date.now() });
  publish();
}

/** Walk one document through extracting → chunking → indexing → ready. Never throws;
 *  failures land as status "failed" + error. Deduped per document within the session. */
export function ensureExtractionJob(doc: DocumentRow): Promise<void> {
  const existing = inflight.get(doc.id);
  if (existing) return existing;
  const job = (async () => {
    const version = doc.extractionVersion + 1;
    try {
      await setStatus(doc.id, {
        status: "extracting",
        attempts: doc.attempts + 1,
        lastAttemptAt: Date.now(),
        error: null,
      });
      const extractor = extractorFor(doc.mime ?? "");
      if (!extractor) throw new Error(`no extractor accepts "${doc.mime ?? "unknown mime"}"`);
      const bytes = await libraryReadBlob(doc.contentHash);
      const extracted = await extractor.extract({ bytes, mime: doc.mime ?? "", title: doc.title });

      await setStatus(doc.id, { status: "chunking" });
      const chunks = chunkSections(extracted.sections);
      if (!chunks.length) throw new Error("extraction produced no text");

      await setStatus(doc.id, { status: "indexing" });
      const now = Date.now();
      // Chunk inserts drive chunk_fts via the migration-0014 triggers. Old vectors
      // must go BEFORE the delete+insert (chunk ids change); new ones follow after.
      await deleteDocumentChunkEmbeddings(doc.id);
      await chunkRepo.replaceForDocument(
        doc.id,
        chunks.map((c) => ({
          documentId: doc.id,
          seq: c.seq,
          text: c.text,
          locator: c.locator,
          extractionVersion: version,
          createdAt: now,
        })),
      );

      // Vector arm (capability-gated, dormant by default) — never blocks readiness.
      void indexDocumentChunks(doc.id);

      await setStatus(doc.id, {
        status: "ready",
        extractorId: extractor.id,
        extractionVersion: version,
        ...(extracted.title && doc.title === doc.url ? { title: extracted.title } : {}),
      });
      dlog("knowledge", `ready: doc ${doc.id} (${chunks.length} chunks, ${extractor.id} v${version})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Full detail (with stack) to the dev log channels; the UI stays generic.
      // The DB `error` keeps the detail too — it's a dev-inspectable field.
      derror("knowledge", `extraction failed for doc ${doc.id} (${doc.mime}, ${doc.byteSize ?? "?"}b, ${doc.extractorId ?? extractorFor(doc.mime ?? "")?.id ?? "no-extractor"}):`, err);
      await setStatus(doc.id, { status: "failed", error: message }).catch(() => {});
    }
  })();
  inflight.set(doc.id, job);
  void job.finally(() => {
    if (inflight.get(doc.id) === job) inflight.delete(doc.id);
  });
  return job;
}

export interface SaveToLibraryInput {
  scope: "topic" | "profile";
  topicId: string | null;
  origin: "search" | "upload" | "chat";
  title: string;
  kind: DocumentKind;
  /** binding role (topic-creation design); defaults by origin — uploads via
   *  guessRole(filename), saved papers/PDFs → ground-truth, else reference */
  role?: SourceRole;
  addedFromConceptId?: string | null;
}

/** Shared tail of both save paths: find-or-create the document row for a stored
 *  blob, find-or-create the requested binding, and kick extraction if needed. */
async function bindStoredBlob(
  blob: { contentHash: string; localPath: string; mime: string; byteSize: number; finalUrl: string | null },
  input: SaveToLibraryInput,
): Promise<{ documentId: number; sourceId: string }> {
  const now = Date.now();
  let doc = await documentRepo.getByHash(blob.contentHash);
  if (!doc) {
    // A PDF saved from a "web" search result is still a PDF — trust the sniffed mime.
    const kind = blob.mime === "application/pdf" && input.kind === "web" ? "pdf" : input.kind;
    doc = await documentRepo.create({
      contentHash: blob.contentHash,
      url: blob.finalUrl,
      localPath: blob.localPath,
      mime: blob.mime,
      byteSize: blob.byteSize,
      title: input.title,
      kind,
      status: "queued",
      meta: blob.finalUrl ? { domain: new URL(blob.finalUrl).hostname.replace(/^www\./, "") } : {},
      createdAt: now,
      updatedAt: now,
    });
  }

  let binding = await sourceRepo.findBinding(doc.id, input.scope, input.topicId);
  if (!binding) {
    const role =
      input.role ??
      (doc.kind === "paper" || doc.kind === "pdf" ? "ground-truth" : "reference");
    await sourceRepo.create({
      id: crypto.randomUUID(),
      documentId: doc.id,
      scope: input.scope,
      topicId: input.topicId,
      origin: input.origin,
      role,
      pinned: false,
      addedFromConceptId: input.addedFromConceptId ?? null,
      createdAt: now,
    });
    binding = await sourceRepo.findBinding(doc.id, input.scope, input.topicId);
  }
  if (!binding) throw new Error("binding insert did not persist");
  publish();

  if (doc.status !== "ready") void ensureExtractionJob(doc);
  return { documentId: doc.id, sourceId: binding.id };
}

/** "Save to library" for a web URL (the ResourcesLens action). Fetches the bytes
 *  (hardened Rust path), then binds + extracts. Throws on fetch failure — the
 *  caller surfaces it on the card; nothing half-saved is left behind. */
export async function saveUrlToLibrary(
  url: string,
  input: SaveToLibraryInput,
): Promise<{ documentId: number; sourceId: string }> {
  const blob = await libraryFetch(url);
  return bindStoredBlob({ ...blob, finalUrl: blob.finalUrl ?? url }, input);
}

/** Save user-uploaded bytes (webview file input) into the library (K3 uploads UI). */
export async function saveUploadToLibrary(
  file: { name: string; bytes: Uint8Array; mime?: string },
  input: Omit<SaveToLibraryInput, "origin" | "title"> & { title?: string },
): Promise<{ documentId: number; sourceId: string }> {
  let b64 = "";
  const CHUNK = 0x8000; // avoid call-stack limits on String.fromCharCode
  for (let i = 0; i < file.bytes.length; i += CHUNK) {
    b64 += String.fromCharCode(...file.bytes.subarray(i, i + CHUNK));
  }
  const blob = await libraryStoreBytes(btoa(b64), file.mime);
  return bindStoredBlob(blob, {
    ...input,
    origin: "upload",
    title: input.title ?? file.name,
    role: input.role ?? guessRole(file.name),
  });
}

/** Remove a binding; when it was the document's last, remove the document and every
 *  derived artifact (chunks → FTS via triggers, refs, blob). */
export async function removeSource(sourceId: string): Promise<void> {
  const binding = await sourceRepo.get(sourceId);
  if (!binding) return;
  await sourceRepo.delete(sourceId);
  if ((await sourceRepo.countForDocument(binding.documentId)) === 0) {
    const doc = await documentRepo.get(binding.documentId);
    for (const ref of await sourceRefRepo.listByDocument(binding.documentId)) {
      const rest = (await sourceRefRepo.listByConcept(ref.conceptId)).filter(
        (r) => r.documentId !== binding.documentId,
      );
      await sourceRefRepo.replaceForConcept(ref.conceptId, rest);
    }
    await deleteDocumentChunkEmbeddings(binding.documentId);
    await chunkRepo.deleteForDocument(binding.documentId);
    await documentRepo.delete(binding.documentId);
    if (doc) await libraryDeleteBlob(doc.contentHash).catch(() => {});
  }
  publish();
}

export async function setSourcePinned(sourceId: string, pinned: boolean): Promise<void> {
  await sourceRepo.setPinned(sourceId, pinned);
  publish();
}

/** User-edited role chip (the heuristic is only a starting point). */
export async function setSourceRole(sourceId: string, role: SourceRole): Promise<void> {
  await sourceRepo.setRole(sourceId, role);
  publish();
}

/** Remove every source binding of a topic (blob-aware, via removeSource) — used by
 *  topic deletion and the stale-draft sweep, BEFORE the topic row goes away. */
export async function removeTopicSources(topicId: string): Promise<void> {
  for (const entry of await sourceRepo.listByTopic(topicId)) {
    await removeSource(entry.source.id).catch(() => {});
  }
}

/** Explicit user retry of a failed document: reset the attempt budget and re-run. */
export async function retryDocument(documentId: number): Promise<void> {
  const doc = await documentRepo.get(documentId);
  if (!doc) return;
  await documentRepo.update(documentId, { attempts: 0, error: null, updatedAt: Date.now() });
  const fresh = await documentRepo.get(documentId);
  if (fresh) void ensureExtractionJob(fresh);
}

/** Await all in-flight extraction jobs for a topic's documents — so "Generate tree"
 *  can wait for a just-dropped syllabus to finish indexing before it shapes the
 *  outline. Bounded by the jobs' own timeouts; resolves immediately when idle. */
export async function awaitTopicIngestion(topicId: string): Promise<void> {
  const entries = await sourceRepo.listByTopic(topicId);
  await Promise.all(entries.map((e) => inflight.get(e.document.id) ?? Promise.resolve()));
}

/** Startup sweep: re-enqueue documents stuck in a non-terminal phase (crash, force
 *  quit). Runs after migrations; bytes are on disk, so resume never re-fetches. */
export async function sweepLibrary(): Promise<void> {
  try {
    const stuck = await documentRepo.nonTerminal();
    const now = Date.now();
    for (const doc of stuck) {
      if (inflight.has(doc.id)) continue;
      if (doc.lastAttemptAt && now - doc.lastAttemptAt < SWEEP_STALE_MS) continue;
      if (doc.attempts >= MAX_ATTEMPTS) {
        await setStatus(doc.id, { status: "failed", error: `gave up after ${doc.attempts} attempts` });
        continue;
      }
      dlog("knowledge", `sweep: resuming doc ${doc.id} from "${doc.status}"`);
      void ensureExtractionJob(doc);
    }
  } catch (err) {
    dlog("knowledge", "sweep failed:", err instanceof Error ? err.message : String(err));
  }
}
