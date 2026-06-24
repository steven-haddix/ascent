// Resources orchestration (web-search spec §5–§6) — the DB-aware layer that bridges the (decoupled)
// search module and the store. Three entry points:
//   groundingForLesson  PRE-generation: reuse a concept's existing resources for grounding when its
//                       query is unchanged (search fires once per concept; regenerate reuses), else
//                       run a fresh search via prepareGrounding (which stashes for persistResources).
//   persistResources    POST-stream finalization: write the stashed set with REPLACE + a
//                       newest-set-wins guard, then publish to the query cache.
//   refreshResources    the "Refresh latest" lens action: force a fresh search and persist now.
import { awaitInflightSearch, buildGroundingText, hashQuery, prepareGrounding, queryFor, takePendingResources } from "../search/grounding";
import type { GroundingCtx, GroundingTarget, PendingResources } from "../search/grounding";
import type { SearchResult } from "../search/types";
import { resourcesRepo, type ResourceInsert, type ResourceRow } from "../store/repositories";
import { queryClient } from "../store/queryClient";
import { dlog } from "../debug";

function toSearchResult(r: ResourceRow): SearchResult {
  return {
    title: r.title,
    url: r.url,
    snippet: r.snippet ?? "",
    source: r.source ?? undefined,
    kind: r.kind,
    publishedAt: r.publishedAt ?? undefined,
    score: r.score ?? undefined,
  };
}

function toInsert(r: SearchResult, p: PendingResources, now: number): ResourceInsert {
  return {
    conceptId: p.conceptId,
    url: r.url,
    title: r.title,
    snippet: r.snippet || null,
    source: r.source ?? null,
    kind: r.kind,
    publishedAt: r.publishedAt ?? null,
    score: r.score ?? null,
    providerId: p.providerId,
    query: p.query,
    queryHash: p.queryHash,
    resourceSetId: p.resourceSetId,
    status: "ready",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** PRE-generation grounding string. Reuses existing ready resources when the concept's query is
 *  unchanged (no search); otherwise runs a fresh search. Always returns a string ("" = ungrounded). */
export async function groundingForLesson(
  concept: GroundingTarget,
  ctx: GroundingCtx,
  signal?: AbortSignal | null,
): Promise<string> {
  try {
    const existing = (await resourcesRepo.listByConcept(concept.id)).filter((r) => r.status === "ready");
    if (existing.length && existing[0].queryHash === hashQuery(queryFor(concept, ctx))) {
      dlog("resources", "grounding from cached resources:", concept.id);
      return buildGroundingText(existing.map(toSearchResult));
    }
  } catch {
    /* fall through to a fresh search */
  }
  return prepareGrounding(concept, ctx, { signal });
}

/** POST-stream finalization step: persist the stashed set (REPLACE), guarded by newest-set-wins. */
export async function persistResources(conceptId: string): Promise<void> {
  await awaitInflightSearch(conceptId); // a slow search may still be running past the grounding wait
  const pending = takePendingResources(conceptId);
  if (!pending) return; // cache-hit regeneration, or nothing was searched
  try {
    // newest-set-wins (§6): never let an older, slower search overwrite a newer persisted set.
    const maxSet = await resourcesRepo.maxSetId(conceptId);
    if (pending.resourceSetId < maxSet) {
      dlog("resources", "stale set — skipping persist:", conceptId, pending.resourceSetId, "<", maxSet);
      return;
    }
    const now = Date.now();
    const seen = new Set<string>();
    const rows = pending.results
      .filter((r) => !seen.has(r.url) && seen.add(r.url)) // dedupe within the set (PK is conceptId,url)
      .map((r) => toInsert(r, pending, now));
    await resourcesRepo.replaceSet(conceptId, rows);
    queryClient.setQueryData(["resources", conceptId], rows as ResourceRow[]);
    dlog("resources", `persisted ${rows.length} for ${conceptId} (set ${pending.resourceSetId})`);
  } catch (err) {
    dlog("resources", "persist failed:", err instanceof Error ? err.message : String(err));
  }
}

/** The "Refresh latest" lens action: force a fresh search (a new, higher resourceSetId) and persist
 *  immediately, replacing the concept's set. Never throws. */
export async function refreshResources(concept: GroundingTarget, ctx: GroundingCtx): Promise<void> {
  await prepareGrounding(concept, ctx); // always searches + stashes (mints a new resourceSetId)
  await persistResources(concept.id);
}
