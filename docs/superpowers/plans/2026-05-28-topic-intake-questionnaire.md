# Topic Intake Questionnaire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a wave-based AI questionnaire between naming a topic and generating its tree, persist the resulting brief on the topic, and thread it into all five generators.

**Architecture:** A stateless engine (`intake.planWave`) plans batches ("waves") of mutually-independent multiple-choice questions; a reducer-driven `TopicIntake` component drives naming → asking → confirming → generating. The synthesized `TopicBrief` is saved on the `topics` row at create time and fed into outline (full Q&A) and lesson/quiz/chat/teach-back (summary only). A "Skip & generate" path keeps today's behavior (brief = undefined).

**Tech Stack:** React 19 + TS, Vercel AI SDK v6 (`generateText` + `Output.object`), Drizzle over rusqlite, TanStack Query. Verification: `bunx tsc --noEmit` + live smoke test (no test runner in repo).

**Spec:** `docs/superpowers/specs/2026-05-28-topic-intake-questionnaire-design.md`

---

## Task 1: Domain types

**Files:** Modify `src/core/types.ts`

- [ ] Add to `types.ts`:

```ts
/** A single AI-authored multiple-choice question in the topic intake. */
export interface IntakeQuestion {
  prompt: string;
  options: string[]; // 3-5 distinct choices
}

/** One answered question — grounding kept for generation. At least one of
 *  `selected` / `other` is set. */
export interface IntakeAnswer {
  prompt: string;
  selected?: string; // the chosen option, if any
  other?: string;    // free-text the learner added, if any
}

/** The persisted intake result — threaded into all generation for a topic. */
export interface TopicBrief {
  summary: string;         // 2-4 sentence synthesized understanding
  answers: IntakeAnswer[]; // the Q&A transcript
}
```

- [ ] `bunx tsc --noEmit` → clean. Commit: `feat(types): TopicBrief + intake question/answer types`.

## Task 2: Schema column + migration

**Files:** Modify `src/core/store/schema.ts`; generate `src/core/store/migrations/0003_*.sql`

- [ ] In `schema.ts`, import `TopicBrief` and add to `topics`:

```ts
brief: text("brief", { mode: "json" }).$type<TopicBrief>(),
```

- [ ] Run `bunx drizzle-kit generate` → creates `migrations/0003_*.sql` (`ALTER TABLE topics ADD COLUMN brief TEXT;`) + updates `migrations/meta`.
- [ ] Verify the generated SQL is the additive nullable column only. `bunx tsc --noEmit` → clean.
- [ ] Commit: `feat(store): add nullable brief column to topics`.

## Task 3: Intake engine

**Files:** Create `src/core/generation/intake.ts`

- [ ] Create `intake.ts` (model after `outline.ts`):

```ts
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel } from "../ai/service";
import type { IntakeAnswer, IntakeQuestion } from "../types";

export type IntakeWave =
  | { done: false; questions: IntakeQuestion[] }
  | { done: true; summary: string };

const WaveSchema = z.object({
  done: z.boolean().describe("true when you have enough to tailor the learning tree"),
  questions: z
    .array(z.object({
      prompt: z.string().describe("a single clear question"),
      options: z.array(z.string()).describe("3-5 concise, distinct choices"),
    }))
    .describe("independent questions to ask now (empty when done)"),
  summary: z.string().optional().describe("when done: 2-4 sentences on what you'll build"),
});

const MAX_WAVES = 2;

export function formatHistory(history: IntakeAnswer[]): string {
  if (history.length === 0) return "none yet";
  return history
    .map((a) => {
      const ans = [a.selected, a.other && `also: ${a.other}`].filter(Boolean).join(" — ");
      return `Q: ${a.prompt}\nA: ${ans || "(skipped)"}`;
    })
    .join("\n\n");
}

function normalize(raw: z.infer<typeof WaveSchema>, history: IntakeAnswer[], forceDone: boolean): IntakeWave {
  const questions = (raw.questions ?? [])
    .map((q) => ({ prompt: q.prompt?.trim(), options: (q.options ?? []).map((o) => o.trim()).filter(Boolean) }))
    .filter((q): q is IntakeQuestion => !!q.prompt && q.options.length >= 2);
  if (forceDone || raw.done || questions.length === 0) {
    const summary = raw.summary?.trim() || synthesize(history);
    return { done: true, summary };
  }
  return { done: false, questions };
}

function synthesize(history: IntakeAnswer[]): string {
  if (history.length === 0) return "A focused introductory tree on this topic.";
  const bits = history.map((a) => [a.selected, a.other].filter(Boolean).join(" / ")).filter(Boolean);
  return `Building a tree tailored to: ${bits.join("; ")}.`;
}

export async function planWave(
  title: string,
  history: IntakeAnswer[],
  waveIndex: number,
): Promise<IntakeWave> {
  const { output } = await generateText({
    model: getModel(),
    output: Output.object({ schema: WaveSchema }),
    prompt: `You are interviewing a learner before building their learning tree on "${title}".

Prior answers:
${formatHistory(history)}

Ask the next batch of multiple-choice questions that will let you tailor the tree's goal,
depth, scope, and starting point. Put only MUTUALLY INDEPENDENT questions in this batch
(questions whose wording does not depend on another answer). Save any follow-up that needs a
prior answer for the next batch. Each question gets 3-5 short, distinct options. Ask at most
~5 questions total across at most 2 batches. When you have enough, set done=true and write a
2-4 sentence summary of the tree you'll build. No markdown.`,
  });
  return normalize(output, history, waveIndex >= MAX_WAVES - 1);
}
```

- [ ] `bunx tsc --noEmit` → clean. Commit: `feat(generation): wave-based topic intake engine`.

## Task 4: Thread brief into outline + startTopic + hook

**Files:** Modify `src/core/generation/outline.ts`, `src/core/store/hooks.ts`

- [ ] `outline.ts`: import `TopicBrief`; change signatures and prompt:

```ts
export async function outlineTopic(title: string, brief?: TopicBrief | null): Promise<OutlineConcept[]> {
  const briefBlock = brief
    ? `\n\nLearner brief (tailor the tree's depth, scope, and emphasis to this):\n${brief.summary}\n${formatHistory(brief.answers)}`
    : "";
  // ...existing generateText, append ${briefBlock} to the prompt...
}

export async function startTopic(
  title: string,
  brief?: TopicBrief | null,
): Promise<{ topicId: string; rootConceptId: string }> {
  const outline = await outlineTopic(title, brief);
  // ...existing...
  await topicRepo.create({ id: topicId, title, rootConceptId: rootId, createdAt: now, brief: brief ?? null });
  // ...existing...
}
```
(Import `formatHistory` from `./intake`.)

- [ ] `hooks.ts`: change `useStartTopic`:

```ts
export function useStartTopic() {
  return useMutation({
    mutationFn: ({ title, brief }: { title: string; brief?: TopicBrief | null }) => startTopic(title, brief),
    onSuccess: () => { /* existing invalidations */ },
  });
}
```
(Import `TopicBrief` from `../types`.)

- [ ] `bunx tsc --noEmit` → expect errors at the `useStartTopic().mutate(title)` call site in `App.tsx` (fixed in Task 7) and `useGenerateQuiz` (Task 5). Confirm only those expected call-site errors. Commit: `feat(generation): outline honors the topic brief`.

## Task 5: Thread briefSummary into lesson / quiz / chat / teach-back

**Files:** Modify `src/core/generation/lesson.ts`, `quiz.ts`, `tutor.ts`, `teachback.ts`

- [ ] `lesson.ts`: add `briefSummary?: string | null;` to `LessonContext`; in `generateLesson`, build
  `const brief = ctx.briefSummary ? \`\nLearner brief (tailor depth, emphasis, and examples to this): ${ctx.briefSummary}\` : "";`
  and interpolate `${brief}` into the prompt after the `children` line.
- [ ] `quiz.ts`: `generateQuiz(concept, topicTitle, briefSummary?: string | null)`; append
  `${briefSummary ? \`\nKeep it aligned with the learner brief: ${briefSummary}\` : ""}` to the prompt.
- [ ] `tutor.ts`: add `briefSummary?: string | null;` to `ChatContext`; append
  `${ctx.briefSummary ? \` Learner brief: ${ctx.briefSummary}.\` : ""}` into the `system` string.
- [ ] `teachback.ts`: add `briefSummary?: string | null;` to `TeachContext`; build a `brief` line like `lesson.ts` and interpolate after `${focus}`.
- [ ] `hooks.ts`: `useGenerateQuiz(concept, topicTitle, briefSummary?)` → `generateQuiz(concept, topicTitle, briefSummary)`.
- [ ] `bunx tsc --noEmit` → expect only the `App.tsx`/`AppShell.tsx` call-site errors (Task 7). Commit: `feat(generation): thread brief into lesson, quiz, chat, teach-back`.

## Task 6: TopicIntake UI component

**Files:** Create `src/ui/TopicIntake.tsx`

- [ ] Build a reducer state machine with states `naming | planning | asking | confirming | generating | error`. Reuse `Trailhead` for `naming` (its `onStart` begins the intake; add a "Skip & generate" button). State shape: `{ status, title, history: IntakeAnswer[], wave: IntakeQuestion[], qIndex, draftSelected?, draftOther, summary?, error? }`.
- [ ] Behavior:
  - `naming` Start → `planning`; call `planWave(title, [], 0)`.
  - wave with questions → `asking`, show one question at a time (radio options + always-present optional "Other" text). "Next" enabled when `draftSelected || draftOther.trim()`; on last question of the wave → push answers, `planning` → `planWave(title, history, waveIndex+1)`.
  - `done` → `confirming` (render `summary` + Generate / Restart / Cancel).
  - Generate → `generating` → `onGenerate(title, { summary, answers: history })`.
  - Skip (any naming/error) → `generating` → `onGenerate(title, undefined)`.
  - Restart → clear `history`/`summary`, `planning` from wave 0. Cancel → `onCancel()`.
  - Any `planWave` failure → `error` (message + Retry + Skip & generate).
- [ ] Props: `{ onGenerate: (title: string, brief?: TopicBrief) => void; onCancel: () => void; busy: boolean; error?: string | null }` (busy/error reflect the outer `startTopic` mutation during `generating`).
- [ ] Style to match `Trailhead` (centered card, `bg-bg`, `text-ink`, accent buttons).
- [ ] `bunx tsc --noEmit` → clean for this file. Commit: `feat(ui): TopicIntake questionnaire component`.

## Task 7: Wire into App + AppShell

**Files:** Modify `src/ui/App.tsx`, `src/ui/AppShell.tsx`

- [ ] `App.tsx`: `handleStartTopic = (title: string, brief?: TopicBrief) => startTopic.mutate({ title, brief }, { onSuccess... })`. Pass `brief` through. Keep `onNewTopic` (Cancel target).
- [ ] `AppShell.tsx`:
  - Replace `<Trailhead onStart={onStartTopic} busy={starting} error={startError} />` with
    `<TopicIntake onGenerate={onStartTopic} onCancel={onNewTopic} busy={starting} error={startError} />`.
    Update the `AppShellProps` type: `onStartTopic: (title: string, brief?: TopicBrief) => void` and add `onNewTopic` to the props passed down (already exists at App level).
  - Compute `const activeTopic = topics.find((t) => t.id === activeTopicId); const briefSummary = activeTopic?.brief?.summary ?? null;`
  - Pass `briefSummary` into the Lesson ctx ([line ~360](../../../src/ui/AppShell.tsx)), the Chat ctx, the Teach ctx, and the quiz hook call.
- [ ] `bunx tsc --noEmit` → fully clean.
- [ ] **Live smoke test** (`bun run tauri dev`):
  1. New topic → answer ≥1 wave incl. an "Other" entry → confirm → Generate; tree appears and a lesson reflects the brief.
  2. "Skip & generate" → behaves like today.
  3. Restart re-plans from Q1; Cancel returns home.
  4. Bad/again error path shows Retry + Skip.
- [ ] Commit: `feat(ui): AI topic-intake questionnaire on new topic`.

## Self-Review notes

- **Spec coverage:** waves (T3), full-brief→outline (T4), summary→4 generators (T5), persistence (T2/T4), skippable (T6/T7), Other field (T6), confirm/restart/cancel (T6), edge cases via `normalize`/reducer (T3/T6). ✓
- **Type consistency:** `TopicBrief`/`IntakeAnswer`/`IntakeQuestion` defined T1, used T3–T7; `briefSummary` name consistent across lesson/quiz/chat/teach contexts. ✓
- **No test runner:** verification is `tsc` + live, by project practice.
