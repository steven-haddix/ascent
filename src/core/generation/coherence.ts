// Self-healing coherence (Continuity B6) — FLAG-ONLY v1. Lessons are living documents:
// when their context shifts (a prerequisite's mastery moves materially, or the canon
// changes), dependents are marked `stale` and the learner is offered a one-click refresh.
//
// AUTO-revise (rewriting a lesson WITHOUT asking) is the trust risk and is gated on spike
// #1 (drift-check precision) — it is intentionally NOT enabled here. Every change is
// learner-initiated, versioned, and reversible (prevSnapshot → one-step undo). A refresh
// never runs while the lesson is streaming.
import { canonRepo, lessonRepo, type ConceptRow } from "../store/repositories";
import { queryClient } from "../store/queryClient";
import { ensureLessonStream, isLessonStreaming } from "./lessonStreams";
import type { LessonContext } from "./lessonPrompt";
import type { LessonSnapshot } from "../types";
import { dlog } from "../debug";

/** Mastery must move at least this much (B5) before dependents are flagged for refresh —
 *  we do NOT churn on every minor tick. */
export const MATERIAL_MASTERY_DELTA = 0.2;

/** When a concept's mastery moves materially, mark already-generated lessons that BUILD ON
 *  it (canon prereq graph, reverse lookup) as stale, so the learner is offered a refresh.
 *  No-op without a canon. Never throws. */
export async function markStaleForDependents(
  topicId: string,
  conceptId: string,
  masteryDelta: number,
): Promise<void> {
  if (Math.abs(masteryDelta) < MATERIAL_MASTERY_DELTA) return;
  try {
    const canon = await canonRepo.get(topicId);
    if (!canon) return;
    const dependents = Object.entries(canon.prereqs)
      .filter(([, deps]) => deps.includes(conceptId))
      .map(([dep]) => dep);
    for (const depId of dependents) {
      const lesson = await lessonRepo.get(depId);
      if (lesson && !lesson.stale) {
        await lessonRepo.update(depId, { stale: true });
        queryClient.setQueryData(["lesson", depId], (prev: unknown) =>
          prev ? { ...(prev as object), stale: true } : prev,
        );
      }
    }
    if (dependents.length) dlog("coherence", "flagged", dependents.length, "dependents of", conceptId);
  } catch (err) {
    dlog("coherence", "stale-mark failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Learner-initiated refresh: snapshot the current body for one-step undo, bump the
 *  version, then regenerate with the now-current canon/digests/learner state. The
 *  regenerate's upsert only writes content columns, so the version/snapshot metadata set
 *  here survives. Never runs while the lesson is streaming. */
export async function refreshLesson(
  concept: ConceptRow,
  ctx: LessonContext,
  reason = "Your understanding changed",
): Promise<void> {
  if (isLessonStreaming(concept.id)) return;
  const lesson = await lessonRepo.get(concept.id);
  if (!lesson) return;
  const snapshot: LessonSnapshot = { subtitle: lesson.subtitle ?? null, blocks: lesson.blocks };
  await lessonRepo.update(concept.id, {
    prevSnapshot: snapshot,
    version: (lesson.version ?? 1) + 1,
    revisedAt: Date.now(),
    revisedReason: reason,
    stale: false,
  });
  ensureLessonStream(concept, ctx);
}

/** One-step undo: restore the body captured before the last refresh, and drop the snapshot. */
export async function revertLesson(conceptId: string): Promise<void> {
  const lesson = await lessonRepo.get(conceptId);
  if (!lesson?.prevSnapshot) return;
  const snap = lesson.prevSnapshot;
  await lessonRepo.update(conceptId, {
    subtitle: snap.subtitle,
    blocks: snap.blocks,
    prevSnapshot: null,
    revisedReason: null,
    stale: false,
  });
  queryClient.invalidateQueries({ queryKey: ["lesson", conceptId] });
}

/** Clear the stale flag without regenerating (the learner dismissed the refresh nudge). */
export async function dismissStale(conceptId: string): Promise<void> {
  await lessonRepo.update(conceptId, { stale: false });
  queryClient.setQueryData(["lesson", conceptId], (prev: unknown) =>
    prev ? { ...(prev as object), stale: false } : prev,
  );
}
