// Widget builder jobs — navigation-surviving, deduplicated background builds,
// the widget counterpart of lessonStreams. A job owns one (conceptId, widgetId)
// row's generate → compile loop and publishes every state change to the query
// cache; the UI reads rows via useWidget, never the registry. Render failures
// (the gate only a mounted sandbox can run) come back in through
// reportWidgetRenderFailure and re-enter the same loop.
import { widgetRepo, type WidgetRow } from "../store/repositories";
import { queryClient } from "../store/queryClient";
import { getTaskModelId } from "../settings";
import { widgetKeysFor } from "../widgets/keys";
import { generateWidget } from "./widget";
import { dlog } from "../debug";
import type { Block } from "../types";

export interface WidgetJobInput {
  conceptId: string;
  conceptTitle: string;
  widgetId: string;
  title: string;
  spec: string;
  topicTitle?: string;
  path?: string[];
  /** previous source when the chat tutor is iterating on an existing widget */
  prevSource?: string;
}

interface WidgetJobOpts {
  /** resume/retry: how many attempts this row has already burned */
  startAttempts?: number;
  /** the failure to feed back to the model */
  priorError?: string;
}

/** Generation attempts per widget (compile + render failures both count). */
const MAX_ATTEMPTS = 2;
/** Per-attempt watchdog — a hung non-streaming request must not zombie the job. */
const ATTEMPT_TIMEOUT_MS = 120_000;

const running = new Set<string>();
// Signatures (key|spec) this session already settled — lets the per-partial
// stream scan stay O(1) instead of hitting the DB on every re-delivered block.
const settled = new Set<string>();

const keyOf = (conceptId: string, widgetId: string) => `${conceptId}:${widgetId}`;

export function isWidgetJobRunning(conceptId: string, widgetId: string): boolean {
  return running.has(keyOf(conceptId, widgetId));
}

function publish(row: WidgetRow) {
  queryClient.setQueryData(["widget", row.conceptId, row.widgetId], row);
}

/** Start building a widget, or no-op if a build for it is already running (or
 *  this exact (widget, spec) already settled). `opts` marks an explicit
 *  resume/retry, which bypasses the settled guards. */
export function ensureWidgetJob(input: WidgetJobInput, opts?: WidgetJobOpts): void {
  const key = keyOf(input.conceptId, input.widgetId);
  const sig = `${key}|${input.spec}`;
  if (running.has(key)) return;
  if (!opts && settled.has(sig)) return;
  running.add(key);
  dlog("widget", "job →", input.widgetId, opts ? `(resume @${opts.startAttempts})` : "");

  void (async () => {
    try {
      const existing = await widgetRepo.get(input.conceptId, input.widgetId);
      // Re-scan/remount of something already built (or terminally failed) for
      // this exact spec: nothing to do. Only explicit retries (opts) re-enter.
      if (!opts && existing && existing.spec === input.spec && existing.status !== "generating") {
        settled.add(sig);
        return;
      }
      const createdAt = existing?.createdAt ?? Date.now();
      const model = getTaskModelId("widget");
      let attempts = opts?.startAttempts ?? 0;
      let priorError = opts?.priorError;

      while (attempts < MAX_ATTEMPTS) {
        attempts += 1;
        const generating: WidgetRow = {
          conceptId: input.conceptId,
          widgetId: input.widgetId,
          title: input.title,
          spec: input.spec,
          status: "generating",
          source: null,
          compiled: null,
          error: priorError ?? null,
          attempts,
          model,
          createdAt,
          updatedAt: Date.now(),
        };
        await widgetRepo.upsert(generating);
        publish(generating);

        try {
          const { source, compiled } = await generateWidget({
            conceptTitle: input.conceptTitle,
            topicTitle: input.topicTitle,
            path: input.path,
            title: input.title,
            spec: input.spec,
            prevSource: input.prevSource,
            priorError,
            signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
          });
          const ready: WidgetRow = { ...generating, status: "ready", source, compiled, error: null, updatedAt: Date.now() };
          await widgetRepo.upsert(ready);
          publish(ready);
          dlog("widget", "ready:", input.widgetId, `(attempt ${attempts})`);
          return;
        } catch (err) {
          priorError = err instanceof Error ? err.message : String(err);
          dlog("widget", `attempt ${attempts} failed:`, input.widgetId, "—", priorError);
        }
      }

      const failed: WidgetRow = {
        conceptId: input.conceptId,
        widgetId: input.widgetId,
        title: input.title,
        spec: input.spec,
        status: "failed",
        source: null,
        compiled: null,
        error: priorError ?? "generation failed",
        attempts: MAX_ATTEMPTS,
        model,
        createdAt,
        updatedAt: Date.now(),
      };
      await widgetRepo.upsert(failed);
      publish(failed);
    } catch (err) {
      // Infrastructure failure (store unreachable etc.) — log; the stuck-row
      // resume on next mount re-enters.
      dlog("widget", "job crashed:", input.widgetId, "—", String(err));
    } finally {
      running.delete(key);
      settled.add(sig);
    }
  })();
}

/** Scan a lesson's (possibly still-streaming) blocks and kick a build for every
 *  SETTLED widget placeholder. While streaming, the last block may still be
 *  growing, so it only counts once a later block exists (`includeLast` covers
 *  the final, persisted pass). Idempotent across hundreds of partials. */
export function scanForWidgetJobs(
  concept: { id: string; title: string },
  ctx: { topicTitle: string; path: string[] },
  blocks: ReadonlyArray<Block | undefined> | undefined,
  includeLast: boolean,
): void {
  if (!blocks?.length) return;
  const keys = widgetKeysFor(blocks);
  blocks.forEach((b, i) => {
    if (b?.kind !== "widget") return;
    if (!includeLast && i >= blocks.length - 1) return;
    const title = b.title?.trim();
    const spec = b.spec?.trim();
    if (!title || !spec) return;
    ensureWidgetJob({
      conceptId: concept.id,
      conceptTitle: concept.title,
      widgetId: keys.get(i)!,
      title,
      spec,
      topicTitle: ctx.topicTitle,
      path: ctx.path,
    });
  });
}

/** The render gate reporting back: a `ready` widget crashed when mounted. Retries
 *  with the error if the row has attempts left, else marks it failed.
 *  `renderedUpdatedAt` guards staleness — a report about source that has since
 *  been regenerated is dropped. */
export async function reportWidgetRenderFailure(
  conceptId: string,
  conceptTitle: string,
  widgetId: string,
  message: string,
  renderedUpdatedAt: number,
): Promise<void> {
  if (isWidgetJobRunning(conceptId, widgetId)) return;
  const row = await widgetRepo.get(conceptId, widgetId);
  if (!row || row.status !== "ready" || row.updatedAt !== renderedUpdatedAt) return;
  const error = `the component compiled but crashed when rendered: ${message}`;
  if (row.attempts >= MAX_ATTEMPTS) {
    const failed: WidgetRow = { ...row, status: "failed", error, updatedAt: Date.now() };
    await widgetRepo.upsert(failed);
    publish(failed);
    return;
  }
  ensureWidgetJob(
    { conceptId, conceptTitle, widgetId, title: row.title, spec: row.spec },
    { startAttempts: row.attempts, priorError: error },
  );
}

/** Manual Retry (the failed card) — restarts the loop with a clean slate. */
export function retryWidget(row: WidgetRow, conceptTitle: string): void {
  ensureWidgetJob(
    {
      conceptId: row.conceptId,
      conceptTitle,
      widgetId: row.widgetId,
      title: row.title,
      spec: row.spec,
    },
    { startAttempts: 0 },
  );
}

/** Self-healing for rows stuck `generating` (app quit mid-build): re-enter the
 *  loop, not counting the interrupted attempt against the budget. */
export function resumeWidgetJobIfStuck(row: WidgetRow, conceptTitle: string): void {
  if (row.status !== "generating" || isWidgetJobRunning(row.conceptId, row.widgetId)) return;
  ensureWidgetJob(
    {
      conceptId: row.conceptId,
      conceptTitle,
      widgetId: row.widgetId,
      title: row.title,
      spec: row.spec,
    },
    { startAttempts: Math.max(0, row.attempts - 1), priorError: row.error ?? undefined },
  );
}
