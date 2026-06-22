// Ordered, fire-and-forget post-stream pipeline. Steps run AFTER a lesson is
// persisted + published (off the render critical path); a step throwing is
// isolated and logged, never aborting siblings. Later waves register steps here
// (lesson digest, canon merge, visual completeness pass, media job scan).
import type { ConceptRow } from "../store/repositories";
import type { LessonContext } from "./lessonPrompt";
import type { generateLesson } from "./lesson";
import { dlog } from "../debug";

/** The persisted lesson row as generateLesson returns it (keeps in sync if columns change). */
export type FinalizedLesson = Awaited<ReturnType<typeof generateLesson>>;

export interface FinalizationContext {
  concept: ConceptRow;
  ctx: LessonContext;
  lesson: FinalizedLesson;
}

export interface FinalizationStep {
  name: string;
  /** Lower runs first. Widget scan = 10; later waves choose their slot. */
  order: number;
  run(fctx: FinalizationContext): void | Promise<void>;
}

const steps: FinalizationStep[] = [];

/** Register (or replace, by name) a finalization step. Idempotent on name so a
 *  module re-import in dev/HMR doesn't double-register. */
export function registerFinalizationStep(step: FinalizationStep): void {
  const i = steps.findIndex((s) => s.name === step.name);
  if (i >= 0) steps[i] = step; else steps.push(step);
}

/** Run all steps in ascending `order`. Each step is isolated: a throw is logged
 *  and the remaining steps still run. Never rejects. */
export async function runFinalization(fctx: FinalizationContext): Promise<void> {
  for (const step of [...steps].sort((a, b) => a.order - b.order)) {
    try {
      await step.run(fctx);
    } catch (err) {
      dlog("finalize", `step "${step.name}" failed:`, err instanceof Error ? err.message : String(err));
    }
  }
}

/** TEST-ONLY: clear the registry between test cases. */
export function __resetFinalizationSteps(): void {
  steps.length = 0;
}
