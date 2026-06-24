// GenerationService — lesson bodies. Streamed on first visit and persisted.
// generateLesson streams partial lessons (onPartial) for progressive rendering,
// then persists the complete, validated result.
import { streamText, Output } from "ai";
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { getModelFor } from "../ai/service";
import { getTaskModelId } from "../settings";
import { dlog, since } from "../debug";
import { lessonRepo, conceptRepo, linkRepo, type ConceptRow } from "../store/repositories";
import { normalizeTitle } from "../store/match";
import type { Block, SuggestedFork, SuggestedLesson, LensId } from "../types";
import { LessonSchema } from "./lessonSchema";
import { buildLessonPrompt, type LessonContext } from "./lessonPrompt";
import { buildContinuitySection } from "./continuity";
import { groundingForLesson } from "./resourceJobs";

export type { LessonContext } from "./lessonPrompt";

/** A lesson while it's still streaming (fields fill in progressively). */
export interface PartialLesson {
  subtitle?: string;
  blocks?: Block[];
  suggestedLessons?: { handle?: string; reason?: string }[];
  suggestedForks?: SuggestedFork[];
}

export async function generateLesson(
  concept: ConceptRow,
  ctx: LessonContext,
  onPartial?: (partial: PartialLesson) => void,
  signal?: AbortSignal,
) {
  const t0 = performance.now();
  dlog("gen", "start:", concept.title);

  // Continuity (B4): a handful of fast local SQLite reads + the canon assemble a
  // handoff section so this lesson builds on what came before. It never throws and
  // returns "" when there's nothing to inject, so generation is unchanged today.
  const continuity = await buildContinuitySection(concept, ctx);
  // Web search grounding (web-search spec §5): a single search (or reuse of cached resources) feeds
  // a bounded "live web findings" block into the prompt. Best-effort + fail-open — it returns "" on
  // no capability / timeout / error, so generation is never blocked, and it stashes results for the
  // post-stream persistResources step.
  const grounding = await groundingForLesson(concept, ctx, signal);

  const result = streamText({
    model: getModelFor("lesson"),
    output: Output.object({ schema: LessonSchema }),
    providerOptions: {
      anthropic: {
        // Native output_config structured decoding stalls on this broader visual
        // block schema; the JSON tool path still streams partial object input.
        structuredOutputMode: "jsonTool",
      } satisfies AnthropicLanguageModelOptions,
    },
    abortSignal: signal,
    prompt: buildLessonPrompt(concept, ctx, { continuity, grounding }),
  });

  // Capture output now and pre-attach a catch: on abort we throw out of the
  // for-await below without awaiting output, and an un-awaited rejection would
  // surface as an unhandled promise rejection. `await` still sees a rejection on
  // the success path (e.g. a parse error), so real failures still propagate.
  dlog("gen", "stream created @", since(t0));
  const outputPromise = result.output;
  void outputPromise.then(undefined, () => {});

  let n = 0;
  for await (const partial of result.partialOutputStream) {
    n += 1;
    if (n === 1) dlog("gen", "first partial @", since(t0));
    else if (n % 25 === 0) dlog("gen", `partial #${n}, ${(partial as PartialLesson)?.blocks?.length ?? 0} blocks`);
    onPartial?.(partial as unknown as PartialLesson);
  }
  dlog("gen", `stream ended: ${n} partials @`, since(t0));
  const output = await outputPromise;
  dlog("gen", "output ready @", since(t0));

  const now = Date.now();
  const blocks = output.blocks as Block[];
  // Code/Viz lenses are declared only when there's something to surface — keeps the
  // right pane uncluttered for lessons that don't have it.
  const VISUAL_KINDS = new Set<Block["kind"]>(["chart", "diagram", "timeline", "spectrum", "figure", "graph", "map", "media"]);
  const hasCode = blocks.some((b) => b.kind === "code");
  const hasVisual = blocks.some((b) => VISUAL_KINDS.has(b.kind));
  const lenses: LensId[] = ["notes", "quiz", "chat", "teach"];
  if (hasCode) lenses.push("code");
  if (hasVisual) lenses.push("viz");
  // Resolve the model's existing-concept links: it cites handles we assigned in
  // the prompt → conceptId. Fall back to a normalized-title match if it echoed a
  // title instead of a handle. Drop anything unresolved, self-referential, or a
  // duplicate target.
  const byHandle = new Map(ctx.existingConcepts.map((c) => [c.handle, c.conceptId]));
  const byTitle = new Map(ctx.existingConcepts.map((c) => [normalizeTitle(c.title), c.conceptId]));
  const suggestedLessons: SuggestedLesson[] = [];
  const linkedIds = new Set<string>();
  for (const s of output.suggestedLessons ?? []) {
    const ref = (s.handle ?? "").trim();
    if (!ref) continue;
    const targetId = byHandle.get(ref) ?? byTitle.get(normalizeTitle(ref));
    if (!targetId || targetId === concept.id || linkedIds.has(targetId)) continue;
    linkedIds.add(targetId);
    suggestedLessons.push({ conceptId: targetId, reason: s.reason ?? "" });
  }

  const row = {
    conceptId: concept.id,
    title: concept.title,
    subtitle: output.subtitle,
    blocks,
    suggestedForks: output.suggestedForks as SuggestedFork[],
    suggestedLessons,
    lenses,
    model: getTaskModelId("lesson"),
    generatedAt: now,
  };
  await lessonRepo.upsert(row);
  await conceptRepo.update(concept.id, {
    state: "ready",
    status: concept.status === "queued" ? "visited" : concept.status,
  });
  // Eager, deduped cross-link edges for each resolved link (the unique (source,
  // target) index makes a repeat insert a no-op). Feeds the graph view + backlinks.
  await Promise.all(
    suggestedLessons.map((l) =>
      linkRepo.create({
        id: crypto.randomUUID(),
        topicId: concept.topicId,
        sourceConceptId: concept.id,
        targetConceptId: l.conceptId,
        reason: l.reason || null,
        createdAt: now,
      }),
    ),
  );
  return row;
}
