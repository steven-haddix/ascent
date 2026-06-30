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
import { LessonContinuationSchema, LessonSchema } from "./lessonSchema";
import { buildLessonPrompt, type LessonContext } from "./lessonPrompt";
import { buildContinuitySection } from "./continuity";
import { groundingForLesson } from "./resourceJobs";
import { planVisualBrief } from "./visualPlan";
import { buildLessonContinuationPrompt, mergeLessonContinuation, type LessonCheckpoint } from "./lessonRecovery";

export type { LessonContext } from "./lessonPrompt";

/** A lesson while it's still streaming (fields fill in progressively). */
export interface PartialLesson {
  subtitle?: string;
  blocks?: Block[];
  suggestedLessons?: { handle?: string; reason?: string }[];
  suggestedForks?: SuggestedFork[];
}

interface GeneratedLessonOutput {
  subtitle: string;
  blocks: Block[];
  suggestedLessons: { handle: string; reason: string }[];
  suggestedForks: SuggestedFork[];
}

export interface LessonRecoveryInput {
  checkpoint: LessonCheckpoint;
  recoveryHint: string | null;
  originalPrompt: string | null;
}

export interface GenerateLessonOptions {
  recovery?: LessonRecoveryInput;
  /** Persist the exact prompt before the provider starts streaming. */
  onPrepared?: (prompt: string) => void | Promise<void>;
}

type PartialHandler = (partial: PartialLesson) => void | Promise<void>;

const anthropicStructuredOptions = {
  anthropic: {
    // Native output_config structured decoding stalls on this broader visual
    // block schema; the JSON tool path still streams partial object input.
    structuredOutputMode: "jsonTool",
  } satisfies AnthropicLanguageModelOptions,
};

async function streamInitialLesson(
  prompt: string,
  onPartial?: PartialHandler,
  signal?: AbortSignal,
): Promise<GeneratedLessonOutput> {
  const result = streamText({
    model: getModelFor("lesson"),
    output: Output.object({ schema: LessonSchema }),
    providerOptions: anthropicStructuredOptions,
    abortSignal: signal,
    prompt,
  });
  const outputPromise = result.output;
  void outputPromise.then(undefined, () => {});
  let n = 0;
  for await (const partial of result.partialOutputStream) {
    n += 1;
    if (n === 1) dlog("gen", "first partial");
    else if (n % 25 === 0) dlog("gen", `partial #${n}, ${(partial as PartialLesson)?.blocks?.length ?? 0} blocks`);
    await onPartial?.(partial as unknown as PartialLesson);
  }
  dlog("gen", `stream ended: ${n} partials`);
  const output = await outputPromise;
  return {
    subtitle: output.subtitle,
    blocks: output.blocks as Block[],
    suggestedLessons: output.suggestedLessons,
    suggestedForks: output.suggestedForks as SuggestedFork[],
  };
}

async function streamLessonContinuation(
  originalPrompt: string,
  recovery: LessonRecoveryInput,
  onPartial?: PartialHandler,
  signal?: AbortSignal,
): Promise<GeneratedLessonOutput> {
  const prompt = buildLessonContinuationPrompt(originalPrompt, recovery.checkpoint, recovery.recoveryHint);
  const result = streamText({
    model: getModelFor("lesson"),
    output: Output.object({ schema: LessonContinuationSchema }),
    providerOptions: anthropicStructuredOptions,
    abortSignal: signal,
    prompt,
  });
  const outputPromise = result.output;
  void outputPromise.then(undefined, () => {});
  let n = 0;
  for await (const partial of result.partialOutputStream) {
    n += 1;
    const next = partial as unknown as PartialLesson;
    await onPartial?.(mergeLessonContinuation(recovery.checkpoint, next));
  }
  dlog("gen", `continuation ended: ${n} partials`);
  const output = await outputPromise;
  return {
    subtitle: recovery.checkpoint.subtitle ?? output.subtitle ?? "",
    blocks: [...recovery.checkpoint.blocks, ...(output.blocks as Block[])],
    suggestedLessons: output.suggestedLessons,
    suggestedForks: output.suggestedForks as SuggestedFork[],
  };
}

export async function generateLesson(
  concept: ConceptRow,
  ctx: LessonContext,
  onPartial?: PartialHandler,
  signal?: AbortSignal,
  options: GenerateLessonOptions = {},
) {
  const t0 = performance.now();
  dlog("gen", "start:", concept.title);

  let originalPrompt = options.recovery?.originalPrompt ?? null;
  if (!originalPrompt) {
    // Continuity + grounding + the visual brief are computed once and the exact
    // assembled prompt is checkpointed. Recovery reuses it rather than guessing
    // what context the interrupted attempt saw.
    const continuity = await buildContinuitySection(concept, ctx);
    const grounding = await groundingForLesson(concept, ctx, signal);
    const visualBrief = await planVisualBrief(concept, ctx, signal);
    originalPrompt = buildLessonPrompt(concept, ctx, { continuity, grounding, visualBrief });
  }
  await options.onPrepared?.(originalPrompt);
  dlog("gen", options.recovery ? "continuation created @" : "stream created @", since(t0));
  const output = options.recovery
    ? await streamLessonContinuation(originalPrompt, options.recovery, onPartial, signal)
    : await streamInitialLesson(originalPrompt, onPartial, signal);
  dlog("gen", "output ready @", since(t0));

  if (options.recovery && (output.blocks.length < 8 || output.blocks.length > 14)) {
    throw new Error(
      `Lesson continuation validation failed: the combined lesson has ${output.blocks.length} blocks; expected 8-14.`,
    );
  }

  const now = Date.now();
  const blocks = output.blocks as Block[];
  // Code/Viz lenses are declared only when there's something to surface — keeps the
  // right pane uncluttered for lessons that don't have it.
  const VISUAL_KINDS = new Set<Block["kind"]>([
    "chart",
    "diagram",
    "timeline",
    "spectrum",
    "figure",
    "graph",
    "map",
    "media",
    "generated-image",
  ]);
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
