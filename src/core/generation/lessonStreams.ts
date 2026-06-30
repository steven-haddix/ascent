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
import { scanForGeneratedImageJobs } from "./generatedImageJobs";
import { persistResources } from "./resourceJobs";
import { runVisualAuditPass } from "./director";
import { indexDigest } from "./semanticIndex";
import { lessonDraftRepo, lessonRepo, type ConceptRow, type LessonDraftRow } from "../store/repositories";
import { queryClient } from "../store/queryClient";
import { dlog } from "../debug";
import { getTaskModelId } from "../settings";
import { checkpointFromPartial, classifyLessonFailure, type LessonCheckpoint } from "./lessonRecovery";

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
  name: "visual-audit",
  order: 15,
  run: ({ concept, ctx, lesson }) => runVisualAuditPass(concept, ctx, lesson),
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
  name: "generated-images",
  order: 31,
  run: ({ concept, lesson }) => scanForGeneratedImageJobs(concept.id, lesson.blocks),
});

// Web search (spec §5): persist the resources the pre-generation search stashed — REPLACE, off the
// render critical path, reusing the SAME results (never a second search). No-op on a cache-hit
// regeneration that didn't search.
registerFinalizationStep({
  name: "resources",
  order: 35,
  run: ({ concept }) => persistResources(concept.id),
});

export interface LessonStreamState {
  status: "streaming" | "error";
  partial: PartialLesson | null;
  error: string | null;
  autoRetrying?: boolean;
}

// Per-concept snapshots, replaced only on change, so useSyncExternalStore sees a
// referentially-stable value between changes (a fresh object each read would loop).
const snapshots = new Map<string, LessonStreamState>();
const subscribers = new Map<string, Set<() => void>>();
const running = new Set<string>(); // dedup guard — concepts with a live generation
const controllers = new Map<string, AbortController>(); // abort handle per live stream
const abortCause = new Map<string, "idle" | "manual">(); // why a stream was aborted

// If no partial arrives for this long, treat the stream as stalled and abort it.
// A healthy stream emits partials sub-second. The one legit long gap is at the very
// start: web-search grounding (spec §5) runs BEFORE the stream and waits up to ~2 min
// for the search, plus time-to-first-token — so the initial window must clear that
// (GROUND_TIMEOUT_MS = 120s). After the first partial the watchdog re-arms on each
// partial, so a real tail-stall is still caught within this window.
const IDLE_TIMEOUT_MS = 150_000;
const MAX_AUTOMATIC_RECOVERIES = 1;

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

function draftPartial(draft: LessonDraftRow): PartialLesson {
  return { subtitle: draft.subtitle ?? undefined, blocks: draft.blocks };
}

function publishDraft(draft: LessonDraftRow | null) {
  queryClient.setQueryData(["lesson-draft", draft?.conceptId ?? ""], draft);
}

function checkpointWithFloor(partial: PartialLesson | null, draft: LessonDraftRow): LessonCheckpoint {
  if (!partial) {
    return { subtitle: draft.subtitle, blocks: draft.blocks, discardedBlock: draft.discardedBlock };
  }
  const next = checkpointFromPartial(partial);
  const blocks = next.blocks.length >= draft.blocks.length ? next.blocks : draft.blocks;
  return {
    subtitle: next.subtitle ?? draft.subtitle,
    blocks,
    discardedBlock: partial.blocks?.[blocks.length] ?? null,
  };
}

async function saveDraft(draft: LessonDraftRow): Promise<void> {
  await lessonDraftRepo.upsert(draft);
  publishDraft(draft);
}

function newDraft(conceptId: string): LessonDraftRow {
  const now = Date.now();
  return {
    conceptId,
    generationId: crypto.randomUUID(),
    status: "streaming",
    subtitle: null,
    blocks: [],
    discardedBlock: null,
    prompt: null,
    failureKind: null,
    error: null,
    recoveryHint: null,
    finishReason: null,
    attempts: 0,
    model: getTaskModelId("lesson"),
    createdAt: now,
    updatedAt: now,
  };
}

export interface EnsureLessonStreamOptions {
  /** Discard any recoverable draft and begin a fresh generation. */
  restart?: boolean;
}

/** Start generating this concept's lesson, or no-op if one is already streaming
 *  (the dedup that prevents the duplicate-on-return bug). Also serves retry and
 *  regenerate: generateLesson upserts, so a re-run cleanly overwrites. An idle
 *  watchdog aborts a stalled provider connection so it becomes a recoverable error
 *  instead of a forever "streaming…". */
export function ensureLessonStream(
  concept: ConceptRow,
  ctx: LessonContext,
  options: EnsureLessonStreamOptions = {},
): void {
  const id = concept.id;
  if (running.has(id)) {
    dlog("reg", "dedup — already generating", id);
    return;
  }
  dlog("reg", "ensure →", concept.title);
  running.add(id);
  abortCause.delete(id);
  setSnapshot(id, { status: "streaming", partial: null, error: null });

  void (async () => {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (options.restart) {
        await lessonDraftRepo.remove(id);
        queryClient.setQueryData(["lesson-draft", id], null);
      }
      let draft = (await lessonDraftRepo.get(id)) ?? newDraft(id);
      await saveDraft(draft);
      setSnapshot(id, { status: "streaming", partial: draftPartial(draft), error: null });

      let automaticRecoveries = 0;
      for (;;) {
        const controller = new AbortController();
        controllers.set(id, controller);
        abortCause.delete(id);
        let latestPartial: PartialLesson | null = null;
        draft = {
          ...draft,
          status: "streaming",
          attempts: draft.attempts + 1,
          error: null,
          updatedAt: Date.now(),
        };
        await saveDraft(draft);

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
          const isRecovery = !!(draft.prompt || draft.blocks.length || draft.recoveryHint);
          const row = await generateLesson(
            concept,
            ctx,
            async (partial) => {
              latestPartial = partial;
              armWatchdog();
              setSnapshot(id, { status: "streaming", partial, error: null, autoRetrying: automaticRecoveries > 0 });
              scanForWidgetJobs(concept, ctx, partial.blocks, false);

              const checkpoint = checkpointWithFloor(partial, draft);
              if (checkpoint.blocks.length > draft.blocks.length || checkpoint.subtitle !== draft.subtitle) {
                draft = {
                  ...draft,
                  subtitle: checkpoint.subtitle,
                  blocks: checkpoint.blocks,
                  discardedBlock: null,
                  updatedAt: Date.now(),
                };
                await saveDraft(draft);
              }
            },
            controller.signal,
            {
              recovery: isRecovery
                ? {
                    checkpoint: {
                      subtitle: draft.subtitle,
                      blocks: draft.blocks,
                      discardedBlock: draft.discardedBlock,
                    },
                    recoveryHint: draft.recoveryHint,
                    originalPrompt: draft.prompt,
                  }
                : undefined,
              onPrepared: async (prompt) => {
                if (draft.prompt === prompt) return;
                draft = { ...draft, prompt, updatedAt: Date.now() };
                await saveDraft(draft);
              },
            },
          );

          if (idleTimer) clearTimeout(idleTimer);
          await lessonDraftRepo.remove(id);
          queryClient.setQueryData(["lesson-draft", id], null);
          queryClient.setQueryData(["lesson", id], row);
          queryClient.invalidateQueries({ queryKey: ["concepts"] });
          queryClient.invalidateQueries({ queryKey: ["links"] });
          cleanup(id);
          dlog("reg", "complete:", id);
          setSnapshot(id, null);
          void runFinalization({ concept, ctx, lesson: row });
          return;
        } catch (err) {
          if (idleTimer) clearTimeout(idleTimer);
          const cause = abortCause.get(id);
          abortCause.delete(id);
          const failure = classifyLessonFailure(err, cause);
          const checkpoint = checkpointWithFloor(latestPartial, draft);
          draft = {
            ...draft,
            status: cause === "manual" ? "paused" : "failed",
            subtitle: checkpoint.subtitle,
            blocks: checkpoint.blocks,
            discardedBlock: checkpoint.discardedBlock,
            failureKind: failure.kind,
            error: failure.error,
            recoveryHint: failure.recoveryHint,
            finishReason: failure.finishReason,
            updatedAt: Date.now(),
          };
          await saveDraft(draft);
          dlog("reg", "error:", cause ?? failure.kind, "—", failure.error);

          if (cause !== "manual" && automaticRecoveries < MAX_AUTOMATIC_RECOVERIES) {
            automaticRecoveries += 1;
            dlog("reg", "automatic continuation →", id, `(${draft.blocks.length} saved blocks)`);
            setSnapshot(id, {
              status: "streaming",
              partial: draftPartial(draft),
              error: null,
              autoRetrying: true,
            });
            continue;
          }

          cleanup(id);
          setSnapshot(id, { status: "error", partial: draftPartial(draft), error: failure.error });
          return;
        }
      }
    } catch (err) {
      cleanup(id, idleTimer);
      const error = err instanceof Error ? err.message : String(err);
      dlog("reg", "recovery orchestration failed:", error);
      setSnapshot(id, { status: "error", partial: null, error });
    }
  })();
}

/** Remove the recoverable draft without touching the last completed lesson. */
export async function discardLessonDraft(id: string): Promise<void> {
  if (running.has(id)) return;
  await lessonDraftRepo.remove(id);
  queryClient.setQueryData(["lesson-draft", id], null);
  setSnapshot(id, null);
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
