import type { Block } from "../types";
import type { PartialLesson } from "./lesson";

export type LessonFailureKind = "manual" | "timeout" | "truncated" | "validation" | "provider" | "unknown";

export interface LessonCheckpoint {
  subtitle: string | null;
  blocks: Block[];
  discardedBlock: Block | null;
}

/** Combine a continuation stream with its immutable checkpoint for display and
 * further checkpointing. The provider returns new blocks only. */
export function mergeLessonContinuation(
  checkpoint: LessonCheckpoint,
  continuation: PartialLesson,
): PartialLesson {
  return {
    subtitle: checkpoint.subtitle ?? continuation.subtitle,
    blocks: [...checkpoint.blocks, ...(continuation.blocks ?? [])],
    suggestedLessons: continuation.suggestedLessons,
    suggestedForks: continuation.suggestedForks,
  };
}

/** A streamed block is safe to checkpoint once its required, kind-specific
 * fields exist. The structured stream fills objects in order, so a later block
 * proves the previous object is closed; this guard prevents persisting a closed
 * but unusable object. */
export function isCompleteLessonBlock(block: Block): boolean {
  switch (block.kind) {
    case "section":
      return !!block.label?.trim();
    case "paragraph":
    case "callout":
    case "code":
    case "math":
    case "diagram":
      return !!block.text?.trim();
    case "table":
      return !!(block.headers?.length || block.rows?.length);
    case "chart":
      return !!block.series?.some((series) => series.points?.length);
    case "widget":
      return !!(block.widgetId?.trim() && block.title?.trim() && block.spec?.trim());
    case "timeline":
      return !!block.events?.length;
    case "spectrum":
      return !!(block.axis && block.items?.length);
    case "figure":
      return !!(block.figure?.svg?.trim() || block.figure?.mediaId?.trim());
    case "graph":
      return !!block.nodes?.length && Array.isArray(block.edges);
    case "map":
      return !!block.marks?.length;
    case "media":
      return !!(block.mediaId?.trim() && block.query?.trim());
    case "generated-image":
      return !!(block.mediaId?.trim() && block.prompt?.trim());
  }
}

/** Return the durable prefix of a partial structured response. While the model
 * is still inside `blocks`, the last array item may be half-written and is kept
 * only as discarded recovery context. Once either trailing recommendation field
 * appears, the blocks array is known to be closed and the final block is safe. */
export function checkpointFromPartial(partial: PartialLesson): LessonCheckpoint {
  const blocks = partial.blocks ?? [];
  const blocksClosed = partial.suggestedLessons !== undefined || partial.suggestedForks !== undefined;
  const candidates = blocks.slice(0, blocksClosed ? blocks.length : Math.max(0, blocks.length - 1));
  const stable: Block[] = [];
  for (const block of candidates) {
    if (stable.length >= 14) break;
    if (!block || !isCompleteLessonBlock(block)) break;
    stable.push(block);
  }
  return {
    subtitle: partial.subtitle?.trim() || null,
    blocks: stable,
    discardedBlock: blocks[stable.length] ?? null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCause(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause instanceof Error ? cause.message : null;
}

export function classifyLessonFailure(
  error: unknown,
  abortCause?: "idle" | "manual",
): { kind: LessonFailureKind; error: string; recoveryHint: string; finishReason: string | null } {
  const message = errorMessage(error);
  const cause = errorCause(error);
  const finishReason =
    typeof error === "object" && error !== null && "finishReason" in error
      ? String((error as { finishReason?: unknown }).finishReason ?? "") || null
      : null;

  let kind: LessonFailureKind = "unknown";
  if (abortCause === "manual") kind = "manual";
  else if (abortCause === "idle" || /timed? out|timeout|stalled/i.test(message)) kind = "timeout";
  else if (finishReason === "length" || /max(?:imum)? tokens|token limit|truncat/i.test(message)) kind = "truncated";
  else if (/schema|validat|parse|object generated|json/i.test(`${message} ${cause ?? ""}`)) kind = "validation";
  else if (/provider|network|fetch|connection|http|rate limit|overloaded/i.test(message)) kind = "provider";

  const publicError =
    kind === "manual"
      ? "Generation stopped."
      : kind === "timeout"
        ? "The provider stopped responding before the lesson finished."
        : message;
  const detail = [message, cause].filter(Boolean).join(" Cause: ").slice(0, 1_200);
  const recoveryHint =
    kind === "manual"
      ? "The learner paused generation. Continue from the first unfinished block without changing accepted blocks."
      : kind === "timeout" || kind === "truncated" || kind === "provider"
        ? `The previous response was interrupted (${kind}). Continue from the first unfinished block; do not treat accepted content as incorrect.${detail ? ` Transport detail: ${detail}` : ""}`
        : `The previous structured response failed (${kind}). Rebuild the first unfinished block and correct this issue: ${detail}`;

  return { kind, error: publicError, recoveryHint, finishReason };
}

export function buildLessonContinuationPrompt(
  originalPrompt: string,
  checkpoint: LessonCheckpoint,
  recoveryHint: string | null,
): string {
  const accepted = JSON.stringify(checkpoint.blocks, null, 2);
  const discarded = checkpoint.discardedBlock ? JSON.stringify(checkpoint.discardedBlock, null, 2) : "none";
  return `${originalPrompt}

RECOVERY OVERRIDE — CONTINUE AN INTERRUPTED LESSON:
- ${checkpoint.blocks.length} block(s) below are accepted and immutable. Do not repeat, revise, summarize, or renumber them.
- Produce only the remaining blocks needed to bring the combined lesson to 8-14 blocks, followed by suggestedLessons and suggestedForks.
- Start with the first unfinished block. Make the transition from the accepted prefix feel intentional.
- The discarded partial block is context only. Rebuild it cleanly; never copy malformed fields blindly.
- If the subtitle is missing, provide one. Otherwise omit it.

Previous failure guidance:
${recoveryHint || "The previous response ended before the structured lesson was complete."}

Accepted block prefix:
${accepted}

Discarded partial block:
${discarded}

Return a continuation object only: optional subtitle, new blocks only, suggestedLessons, and suggestedForks. No markdown.`;
}
