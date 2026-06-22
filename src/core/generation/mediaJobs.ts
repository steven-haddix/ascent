// Media resolve jobs — a module-level registry that turns a `media` placeholder block
// into a cached, attributed asset, cloned from widgetJobs (dedupe, survives navigation,
// publishes via React Query). The model never sees a URL: it emits {mediaId, query} and a
// job picks an enabled provider → search (Rust) → license-first rank → fetch bytes (Rust,
// to the local cache) → write a media_assets row the renderer joins to.
import type { Block } from "../types";
import { mediaRepo, type MediaAssetInsert, type MediaAssetRow } from "../store/repositories";
import { queryClient } from "../store/queryClient";
import { providerRequest, providerDownload } from "../providerExecutor";
import { mediaProviderRegistry } from "../media/registry";
import { isSearchable, type MediaResult } from "../media/types";
import { dlog } from "../debug";

const running = new Set<string>(); // "conceptId:mediaId" currently resolving
const settled = new Set<string>(); // "conceptId:mediaId|query" settled this session
const keyOf = (conceptId: string, mediaId: string) => `${conceptId}:${mediaId}`;

export interface MediaJobInput {
  conceptId: string;
  mediaId: string;
  query: string;
  purpose?: string;
}

function publish(row: MediaAssetRow) {
  queryClient.setQueryData(["media", row.conceptId, row.mediaId], row);
}

/** Rank candidates: permissive license first (we default to PD/CC), then attribution-free,
 *  then larger images. Selection is app-side; the model never chooses. */
function score(r: MediaResult): number {
  let s = 0;
  const permissive = /public domain|^cc/i;
  if (permissive.test(r.license.name) || permissive.test(r.license.id)) s += 100;
  if (!r.license.requiresAttribution) s += 5;
  if (r.payload.kind === "image" && r.payload.width) s += Math.min(r.payload.width / 100, 20);
  return s;
}

export function isMediaJobRunning(conceptId: string, mediaId: string): boolean {
  return running.has(keyOf(conceptId, mediaId));
}

/** Resolve a media placeholder. No-op if already running/settled (session dedup); an
 *  explicit retry passes force=true. Never throws — failures land as a `failed` row. */
export function ensureMediaJob(input: MediaJobInput, force = false): void {
  const key = keyOf(input.conceptId, input.mediaId);
  const sig = `${key}|${input.query}`;
  if (running.has(key)) return;
  if (!force && settled.has(sig)) return;
  running.add(key);

  void (async () => {
    const now = Date.now();
    const base: MediaAssetInsert = {
      conceptId: input.conceptId,
      mediaId: input.mediaId,
      kind: "image",
      providerId: null,
      query: input.query,
      status: "generating",
      localPath: null,
      width: null,
      height: null,
      license: null,
      attribution: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const existing = await mediaRepo.get(input.conceptId, input.mediaId);
      if (!force && existing && existing.query === input.query && existing.status !== "generating") {
        settled.add(sig);
        return;
      }
      await mediaRepo.upsert(base);
      publish(base as MediaAssetRow);

      const providers = mediaProviderRegistry
        .enabled()
        .filter(isSearchable)
        .filter((p) => p.kinds.includes("image"));
      if (providers.length === 0) {
        const failed = { ...base, status: "failed" as const, error: "No media provider enabled", updatedAt: Date.now() };
        await mediaRepo.upsert(failed);
        publish(failed as MediaAssetRow);
        return;
      }

      let chosen: MediaResult | null = null;
      let chosenProvider = providers[0];
      for (const p of providers) {
        try {
          const res = await providerRequest(p.buildSearch({ kind: "image", query: input.query }));
          const results = p.parseSearch(JSON.parse(res.body));
          const ranked = [...results].sort((a, b) => score(b) - score(a));
          if (ranked.length) {
            chosen = ranked[0];
            chosenProvider = p;
            break;
          }
        } catch (err) {
          dlog("media", "search failed:", p.id, "—", err instanceof Error ? err.message : String(err));
        }
      }
      if (!chosen) {
        const failed = { ...base, status: "failed" as const, error: "No suitable asset found", updatedAt: Date.now() };
        await mediaRepo.upsert(failed);
        publish(failed as MediaAssetRow);
        return;
      }

      const dl = await providerDownload(chosenProvider.buildFetch(chosen));
      const dims = chosen.payload.kind === "image" ? chosen.payload : undefined;
      const ready: MediaAssetInsert = {
        ...base,
        status: "ready",
        providerId: chosen.providerId,
        localPath: dl.localPath,
        width: dl.width ?? dims?.width ?? null,
        height: dl.height ?? dims?.height ?? null,
        license: chosen.license,
        attribution: chosen.attribution,
        updatedAt: Date.now(),
      };
      await mediaRepo.upsert(ready);
      publish(ready as MediaAssetRow);
    } catch (err) {
      dlog("media", "job crashed:", input.mediaId, "—", err instanceof Error ? err.message : String(err));
      try {
        const failed = { ...base, status: "failed" as const, error: String(err), updatedAt: Date.now() };
        await mediaRepo.upsert(failed);
        publish(failed as MediaAssetRow);
      } catch {
        /* ignore */
      }
    } finally {
      running.delete(key);
      settled.add(sig);
    }
  })();
}

/** Kick resolve jobs for settled `media` placeholders in a lesson's blocks (idempotent,
 *  O(1) session dedup). Called from the post-stream finalization pipeline. */
export function scanForMediaJobs(conceptId: string, blocks: ReadonlyArray<Block | undefined> | undefined): void {
  if (!blocks?.length) return;
  for (const b of blocks) {
    if (!b) continue;
    if (b.kind === "media" && b.mediaId && b.query) {
      ensureMediaJob({ conceptId, mediaId: b.mediaId, query: b.query, purpose: b.purpose });
    }
  }
}

/** Re-kick a media job whose row is stuck in `generating` (e.g. app quit mid-resolve). */
export function resumeMediaJobIfStuck(row: MediaAssetRow): void {
  if (row.status !== "generating" || isMediaJobRunning(row.conceptId, row.mediaId)) return;
  ensureMediaJob({ conceptId: row.conceptId, mediaId: row.mediaId, query: row.query }, true);
}
