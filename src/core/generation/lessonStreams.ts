// Lesson generation as a navigation-surviving, deduplicated background stream.
//
// Generation used to live in a component-scoped mutation, so navigating away mid-
// stream orphaned it and returning started a *duplicate* (both racing to upsert).
// This registry owns in-flight generations keyed by conceptId, outside React: a
// stream keeps running when you leave, and returning attaches to it (the hook reads
// it via useSyncExternalStore) instead of starting another.
import { generateLesson, type LessonContext, type PartialLesson } from "./lesson";
import { scanForWidgetJobs } from "./widgetJobs";
import { registerFinalizationStep, runFinalization } from "./finalization";
import { generateDigest } from "./digest";
import { mergeDigestIntoCanon } from "./canon";
import { scanForMediaJobs } from "./mediaJobs";
import { runCompletenessPass } from "./director";
import { indexDigest } from "./semanticIndex";
import { lessonRepo, type ConceptRow } from "../store/repositories";
import { queryClient } from "../store/queryClient";
import { dlog } from "../debug";

// Post-stream finalization steps run in ascending `order` after a lesson is
// persisted + published. The widget scan is the first; later waves register
// digest/canon/visual/media steps here without touching the streaming code.
registerFinalizationStep({
  name: "widgets",
  order: 10,
  run: ({ concept, ctx, lesson }) =>
    scanForWidgetJobs(concept, { topicTitle: ctx.topicTitle, path: ctx.path }, lesson.blocks, true),
});

registerFinalizationStep({
  name: "digest",
  order: 20,
  run: async ({ concept, lesson }) => {
    const digest = await generateDigest({ title: lesson.title, subtitle: lesson.subtitle, blocks: lesson.blocks });
    await lessonRepo.upsert({ ...lesson, digest });
    queryClient.setQueryData(["lesson", concept.id], (prev) => (prev ? { ...(prev as object), digest } : prev));
    await mergeDigestIntoCanon(concept.topicId, concept.id, digest);
    // SemanticIndex (B7): embed the digest if an embeddings provider is configured (dormant otherwise).
    void indexDigest(concept.id, digest);
  },
});

registerFinalizationStep({
  name: "media",
  order: 30,
  run: ({ concept, lesson }) => scanForMediaJobs(concept.id, lesson.blocks),
});

registerFinalizationStep({
  name: "completeness",
  order: 40,
  run: ({ concept, ctx, lesson }) => runCompletenessPass(concept, ctx, lesson),
});

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
const controllers = new Map<string, AbortController>(); // abort handle per live stream
const abortCause = new Map<string, "idle" | "manual">(); // why a stream was aborted

// If no partial arrives for this long, treat the stream as stalled and abort it.
// A healthy stream emits partials sub-second; the only legit gap is time-to-first-
// token at the very start, well under this. So this only fires on a real tail-stall.
const IDLE_TIMEOUT_MS = 40_000;

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

/** Is a generation currently in flight for this concept? Useful for tools that
 *  want to refuse to touch the lesson while it is being (re)generated. */
export function isLessonStreaming(id: string): boolean {
  return running.has(id);
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

function cleanup(id: string, idleTimer?: ReturnType<typeof setTimeout>) {
  if (idleTimer) clearTimeout(idleTimer);
  running.delete(id);
  controllers.delete(id);
}

/** Start generating this concept's lesson, or no-op if one is already streaming
 *  (the dedup that prevents the duplicate-on-return bug). Also serves retry and
 *  regenerate: generateLesson upserts, so a re-run cleanly overwrites. An idle
 *  watchdog aborts a stalled provider connection so it becomes a recoverable error
 *  instead of a forever "streaming…". */
export function ensureLessonStream(concept: ConceptRow, ctx: LessonContext): void {
  const id = concept.id;
  if (running.has(id)) {
    dlog("reg", "dedup — already generating", id);
    return;
  }
  dlog("reg", "ensure →", concept.title);
  running.add(id);
  const controller = new AbortController();
  controllers.set(id, controller);
  abortCause.delete(id);
  setSnapshot(id, { status: "streaming", partial: null, error: null });

  void (async () => {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armWatchdog = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        dlog("reg", `idle ${IDLE_TIMEOUT_MS}ms — aborting stalled stream`, id);
        abortCause.set(id, "idle");
        controller.abort();
      }, IDLE_TIMEOUT_MS);
    };
    try {
      armWatchdog();
      const row = await generateLesson(
        concept,
        ctx,
        (partial) => {
          armWatchdog(); // each partial proves the stream is alive — reset the timer
          setSnapshot(id, { status: "streaming", partial, error: null });
          // Kick builds for settled widget placeholders WHILE the lesson keeps
          // streaming — the cheaper builder agent works in parallel with the prose.
          scanForWidgetJobs(concept, ctx, partial.blocks, false);
        },
        controller.signal,
      );
      // generateLesson already persisted the row; publish it for an instant render
      // and refresh the tree. Runs even if no view is mounted (you navigated away).
      queryClient.setQueryData(["lesson", id], row);
      queryClient.invalidateQueries({ queryKey: ["concepts"] });
      queryClient.invalidateQueries({ queryKey: ["links"] }); // eager edges created during generation
      cleanup(id, idleTimer);
      dlog("reg", "complete:", id);
      setSnapshot(id, null); // done — observers now read the lesson from the query cache
      // Post-stream finalization (widget scan today; digest/canon/visual/media later) —
      // fire-and-forget, off the render critical path; per-step failures are isolated.
      void runFinalization({ concept, ctx, lesson: row });
    } catch (err) {
      cleanup(id, idleTimer);
      const cause = abortCause.get(id);
      abortCause.delete(id);
      const error =
        cause === "idle"
          ? "The lesson stalled — the provider stopped responding before finishing. Retry to pick it back up."
          : cause === "manual"
            ? "Generation stopped."
            : err instanceof Error
              ? err.message
              : String(err);
      dlog("reg", "error:", cause ?? "exception", "—", error);
      setSnapshot(id, { status: "error", partial: null, error });
    }
  })();
}

/** Stop an in-flight generation (the Stop button). Aborts the stream; the catch
 *  above resolves it to an "error" snapshot, so the existing Retry path applies. */
export function cancelLessonStream(id: string): void {
  const controller = controllers.get(id);
  if (!controller) return;
  dlog("reg", "cancel (manual stop)", id);
  abortCause.set(id, "manual");
  controller.abort();
}
