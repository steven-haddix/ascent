# Topic Intake Questionnaire — Design

**Date:** 2026-05-28
**Status:** Approved (pending spec review)
**Area:** New-topic creation flow

## Problem

Creating a new topic today is a single text field ([`Trailhead.tsx`](../../../src/ui/Trailhead.tsx)):
the learner types a subject and the AI immediately sketches a concept tree
([`outlineTopic`](../../../src/core/generation/outline.ts)). The AI has no sense of the
learner's goal, desired depth, prior knowledge, or constraints — so every tree is generic.

We want a short, survey-style **AI questionnaire** between the topic name and tree
generation. The AI asks a few multiple-choice follow-ups to refine the goal and depth,
confirms its understanding, and only then generates — with the refined "brief" threaded
into all downstream generation so the whole topic (lessons, quizzes, chat, teach-back)
honors it.

## Goals

- After naming a topic, the AI asks ~4–5 multiple-choice questions, **one at a time** (survey feel).
- Questions are **dynamic in waves**: the AI returns a batch of mutually-independent questions
  it can ask together; dependent follow-ups come in a second wave after the first is answered.
- Question dimensions and options are **fully AI-driven** (chosen per topic, not a fixed template).
- Each question allows picking one option **and/or** typing into an optional "Other" free-text field.
- A final **confirmation** step shows the AI's synthesized understanding with **Generate / Restart / Cancel**.
- The questionnaire is **skippable** — "Skip & generate" reproduces today's one-field behavior exactly.
- The resulting **brief is persisted on the topic** and threaded into **all five generators**:
  outline, lesson, quiz, chat (tutor), teach-back.

## Non-goals

- No per-question AI calls (waves only — bounded round-trips).
- No resumable / DB-persisted draft briefs during the flow (ephemeral until Generate).
- No changes to the lens system, the concept tree rendering, or the generation pipeline shape.
- No new state-management library (stays lib-free, consistent with the command palette).
- No editing the brief after a topic is created (out of scope for v1).

## Flow

```
name topic
  │
  ▼
[planWave #0] ──► ask Q1, Q2, … (one at a time; the wave's independent questions)
  │                                    │
  │              all answered ─────────┘
  ▼
[planWave #1] ──► (more questions?) ──► ask next wave  ──┐
  │                                                       │
  └──────────────── done ◄────────────────────────────── ┘
  ▼
confirm: AI summary  ──►  Generate / Restart / Cancel
  │ Generate
  ▼
startTopic(title, brief)  ──►  outlineTopic(title, brief)  ──►  open tree (existing path)
```

**Wave** is the abstraction that matches the requested behavior: a wave is a set of
mutually-independent questions the AI emits together (the UI shows them one at a time);
the wave boundary is the dependency boundary (a question that needs a prior answer waits
for the next wave). Capped at **2 waves**. Worst case before the tree appears: 3 AI calls
(wave 0 + wave 1 + outline). The confirmation summary rides along in the wave response that
sets `done = true` — no extra call.

## Data model

New types in [`src/core/types.ts`](../../../src/core/types.ts):

```ts
/** A single AI-authored multiple-choice question in the topic intake. */
export interface IntakeQuestion {
  prompt: string;
  options: string[]; // 3–5 distinct choices
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
  summary: string;          // 2–4 sentence synthesized understanding
  answers: IntakeAnswer[];  // the Q&A transcript
}
```

### Persistence

Add a nullable JSON column to the `topics` table in
[`src/core/store/schema.ts`](../../../src/core/store/schema.ts):

```ts
brief: text("brief", { mode: "json" }).$type<TopicBrief>(),
```

Generate the migration with `bunx drizzle-kit generate` (produces `migrations/0003_*.sql`
+ updates `migrations/meta`, matching the existing convention). The SQL is effectively
`ALTER TABLE topics ADD COLUMN brief TEXT;` — additive and nullable, so existing topics are
unaffected.

`brief` is known **before** the topic row is created (the questionnaire completes first), so
it is written at create time via the existing `topicRepo.create` — **no `topicRepo.update`
needed**. `TopicInsert` (`typeof topics.$inferInsert`) picks up the optional field automatically.

## Module: the intake engine

New file [`src/core/generation/intake.ts`](../../../src/core/generation/intake.ts), modeled on
`outline.ts` (non-streaming `generateText` + `Output.object`):

```ts
export type IntakeWave =
  | { done: false; questions: IntakeQuestion[] } // ask these now (shown one at a time)
  | { done: true; summary: string };             // ready; confirm understanding

export async function planWave(
  title: string,
  history: IntakeAnswer[],
  waveIndex: number,
): Promise<IntakeWave>;
```

Zod schema (small — no `z.union`, few optionals — so it avoids the structured-output stall
documented for large schemas; mirror `outline.ts` and only add
`providerOptions.anthropic.structuredOutputMode: "jsonTool"` if it misbehaves):

```ts
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
```

Prompt sketch (fully AI-driven dimensions):

> You are interviewing a learner before building their learning tree on **"{title}"**.
> Prior answers: {formatted history, or "none yet"}.
> Ask the next batch of multiple-choice questions that will let you tailor the tree's goal,
> depth, scope, and starting point. Put only **mutually independent** questions in this batch
> (questions whose wording does not depend on another answer). Save any follow-up that needs a
> prior answer for the next batch. Keep each question to 3–5 short, distinct options. Ask at most
> ~5 questions total across at most 2 batches. When you have enough, set `done: true` and write a
> 2–4 sentence `summary` of the tree you'll build. No markdown.

Guardrails in `planWave`:
- Force `done: true` when `waveIndex >= 1` (hard cap at 2 waves). If the model didn't supply a
  summary, synthesize a minimal one from `history`.
- Normalize the response: drop questions with `< 2` options; trim blank options; if `done` is
  false but `questions` is empty, treat as `done: true`.

History formatting helper (also reused as prompt grounding): each answer renders as
`Q: {prompt}\nA: {selected}{ other ? " (also: " + other + ")" : "" }` (or just `other` when no
option was selected).

## Threading the brief into generation

The active topic — and therefore its `brief` — is already available where every generation
context is assembled ([`AppShell.tsx`](../../../src/ui/AppShell.tsx)). Thread the concise
`brief.summary` into the four lazy generators; give `outlineTopic` the full brief (its richer
answers most shape the tree). Each prompt gains one guarded line; absent brief ⇒ line omitted ⇒
unchanged behavior.

| Generator | File | Change | Brief input |
|---|---|---|---|
| Outline | `generation/outline.ts` | `outlineTopic(title, brief?)`, `startTopic(title, brief?)` | full `TopicBrief` |
| Lesson | `generation/lesson.ts` | `LessonContext += briefSummary?: string \| null` | `brief.summary` |
| Quiz | `generation/quiz.ts` | `generateQuiz(concept, topicTitle, briefSummary?)` | `brief.summary` |
| Chat | `generation/tutor.ts` | `ChatContext += briefSummary?: string \| null` | `brief.summary` |
| Teach-back | `generation/teachback.ts` | `TeachContext += briefSummary?: string \| null` | `brief.summary` |

Prompt addition (each generator), only when present:
> Learner brief (tailor depth, emphasis, and examples to this): {briefSummary}

Plumbing: `AppShell` reads `activeTopic?.brief` once and passes `briefSummary` into the
`LessonContext` ([AppShell.tsx:360](../../../src/ui/AppShell.tsx#L360)), `ChatContext`,
`TeachContext`, and the quiz hook. `useStartTopic` / `useGenerateQuiz` signatures extend to
carry the brief through ([`hooks.ts`](../../../src/core/store/hooks.ts)).

## UI: the questionnaire

New component [`src/ui/TopicIntake.tsx`](../../../src/ui/TopicIntake.tsx) — a reducer-driven
state machine. **Ephemeral local state**, no DB writes until Generate, no Zustand. It reuses
`Trailhead` as the naming step (keeps that screen) and replaces `<Trailhead>` in `AppShell`'s
"no active topic" branch.

States:

| State | UI | Transitions |
|---|---|---|
| `naming` | `Trailhead` field + "Skip & generate" | Start → `planning`; Skip → `generating` (brief = undefined) |
| `planning` | spinner ("Thinking about what to ask…") | wave→ `asking`; `done`→ `confirming`; error→ `error` |
| `asking` | one question card: options (single-select) + optional "Other" text + progress dots | answer all in wave → `planning` (next wave) |
| `confirming` | AI `summary` + **Generate / Restart / Cancel** | Generate→ `generating`; Restart→ `planning` (clear answers, wave 0); Cancel→ home |
| `generating` | spinner ("Outlining the concept tree…") | success → open topic; error → `error` |
| `error` | inline message + **Retry** + **Skip & generate** | Retry→ retry last step; Skip→ `generating` |

Question card details:
- Options are single-select (radio-style). "Other" is an always-present optional text field; the
  learner may select an option **and** type Other, or type Other alone.
- "Next" enables when `selected` or non-empty `other` is present.
- A back affordance to revise the previous answer within the current wave (nice-to-have; cheap
  with reducer state).

Wiring:
- `AppShell` renders `<TopicIntake onGenerate={(title, brief?) => onStartTopic(title, brief)} onCancel={onNewTopicCancel} />`
  in place of `<Trailhead>`.
- `App.handleStartTopic(title, brief?)` → `useStartTopic().mutate({ title, brief })`.
- `useStartTopic` mutationFn → `startTopic(title, brief)`.

## Architecture choice

- **Chosen:** stateful `TopicIntake` component (reducer) + stateless `intake.planWave` engine.
  Lib-free, ephemeral, and the reducer + response-normalization are pure and unit-testable.
- *Rejected — module-level intake registry* (like `lessonStreams`, survives navigation): YAGNI;
  the intake is short and entirely pre-persistence, and there's no navigation away mid-intake.
- *Rejected — persist draft briefs to the DB during the flow:* pollutes the topic store with
  abandoned drafts and needs cleanup, for a ~30-second flow.

## Edge cases

- AI returns `done` with zero questions → straight to `confirming`.
- A wave/outline call fails → `error` state with **Retry** and **Skip & generate** fallback.
- Model emits a question with `< 2` options → dropped during normalization.
- Wave cap reached without a summary → synthesize a minimal summary from answers; proceed.
- **Restart** → clear `answers` + `summary`, re-run `planWave` from wave 0.
- **Cancel** → discard all intake state, return home (the previously active topic, if any).
- **Skip** at any point → generate with `brief = undefined`; every prompt omits its brief line ⇒
  byte-for-byte today's behavior (regression guard).

## Verification

- `bunx tsc --noEmit` clean (the project's build gate).
- Live smoke test (the project's established practice):
  1. New topic → answer two waves (incl. an "Other" entry) → confirm → Generate; verify the tree
     and a generated lesson reflect the stated goal/depth.
  2. **Skip & generate** → identical to today's flow.
  3. **Restart** mid-flow re-plans from question one; **Cancel** returns home.
  4. Induce an AI error (e.g. invalid key) → `error` state shows Retry + Skip.
- Optional (not in the repo's current practice): a vitest unit test over the reducer transitions
  and `planWave` response-normalization, since both are pure.

## File-by-file change list

**New**
- `src/core/generation/intake.ts` — `planWave`, `IntakeWave`, history formatter, normalization.
- `src/ui/TopicIntake.tsx` — reducer state machine + question card.
- `src/core/store/migrations/0003_*.sql` (+ `meta` update) — adds `topics.brief` (drizzle-kit generated).

**Modified**
- `src/core/types.ts` — `IntakeQuestion`, `IntakeAnswer`, `TopicBrief`.
- `src/core/store/schema.ts` — `topics.brief` column.
- `src/core/generation/outline.ts` — `outlineTopic(title, brief?)`, `startTopic(title, brief?)`, persist brief.
- `src/core/generation/lesson.ts` — `LessonContext.briefSummary` + prompt line.
- `src/core/generation/quiz.ts` — `generateQuiz(..., briefSummary?)` + prompt line.
- `src/core/generation/tutor.ts` — `ChatContext.briefSummary` + system-prompt line.
- `src/core/generation/teachback.ts` — `TeachContext.briefSummary` + prompt line.
- `src/core/store/hooks.ts` — `useStartTopic({title, brief})`, `useGenerateQuiz(..., briefSummary)`.
- `src/ui/App.tsx` — `handleStartTopic(title, brief?)`.
- `src/ui/AppShell.tsx` — render `TopicIntake`; pass `briefSummary` into Lesson/Chat/Teach contexts + quiz.
