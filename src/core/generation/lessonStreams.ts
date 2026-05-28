// Lesson generation as a navigation-surviving, deduplicated background stream.
//
// Generation used to live in a component-scoped mutation, so navigating away mid-
// stream orphaned it and returning started a *duplicate* (both racing to upsert).
// This registry owns in-flight generations keyed by conceptId, outside React: a
// stream keeps running when you leave, and returning attaches to it (the hook reads
// it via useSyncExternalStore) instead of starting another.
import { generateLesson, type LessonContext, type PartialLesson } from "./lesson";
import type { ConceptRow } from "../store/repositories";
import { queryClient } from "../store/queryClient";

export interface LessonStreamState {
  status: "streaming" | "error";
  partial: PartialLesson | null;
  error: string | null;
}

// Per-concept snapshots, replaced only on change, so useSyncExternalStore sees a
// referentially-stable value between changes (a fresh object each read would loop).
const snapshots = new Map<string, LessonStreamState>();
const subscribers = new Map<string, Set<() => void>>();
const running = new Set<string>(); // dedup guard — concepts with a live generation

function emit(id: string) {
  subscribers.get(id)?.forEach((fn) => fn());
}

function setSnapshot(id: string, state: LessonStreamState | null) {
  if (state) snapshots.set(id, state);
  else snapshots.delete(id);
  emit(id);
}

export function getLessonStreamSnapshot(id: string): LessonStreamState | null {
  return snapshots.get(id) ?? null; // `null` is a stable reference between renders
}

export function subscribeLessonStream(id: string, cb: () => void): () => void {
  let subs = subscribers.get(id);
  if (!subs) {
    subs = new Set();
    subscribers.set(id, subs);
  }
  subs.add(cb);
  return () => {
    subs.delete(cb);
    if (subs.size === 0) subscribers.delete(id);
  };
}

/** Start generating this concept's lesson, or no-op if one is already streaming
 *  (the dedup that prevents the duplicate-on-return bug). Also serves retry and
 *  regenerate: generateLesson upserts, so a re-run cleanly overwrites. */
export function ensureLessonStream(concept: ConceptRow, ctx: LessonContext): void {
  const id = concept.id;
  if (running.has(id)) return;
  running.add(id);
  setSnapshot(id, { status: "streaming", partial: null, error: null });

  void (async () => {
    try {
      const row = await generateLesson(concept, ctx, (partial) =>
        setSnapshot(id, { status: "streaming", partial, error: null }),
      );
      // generateLesson already persisted the row; publish it for an instant render
      // and refresh the tree. Runs even if no view is mounted (you navigated away).
      queryClient.setQueryData(["lesson", id], row);
      queryClient.invalidateQueries({ queryKey: ["concepts"] });
      running.delete(id);
      setSnapshot(id, null); // done — observers now read the lesson from the query cache
    } catch (err) {
      running.delete(id);
      setSnapshot(id, {
        status: "error",
        partial: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}
