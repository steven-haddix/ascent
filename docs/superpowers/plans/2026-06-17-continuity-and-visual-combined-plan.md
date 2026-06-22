# Continuity Engine + Visual Learning System — Combined Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute two approved design specs — [Continuity Engine](../specs/2026-06-17-continuity-engine-design.md) (lessons that build on each other via a living course memory + AI provider/capability registry) and [Visual Learning System](../specs/2026-06-17-visual-learning-system-design.md) (humanities-native visual coverage via a visual registry + media providers + d3) — in one dependency-ordered sequence, sharing the seams both specs touch.

**Architecture:** A shared lesson-generation seam (prompt + schema assembly, `getModelFor` routing, one post-stream finalization pipeline) is carved out first so neither spec rewrites `lesson.ts`/`lessonStreams.ts` independently. The Continuity "felt win" (Course Canon + Lesson Digests + continuity context + handoff prompt + Previously/Up-next bands) lands next on today's single provider. Then the native visual registry (catalog/authoring/renderer/job facets) + `timeline`/`spectrum`. Then the shared provider/Sources infrastructure (AI providers + media providers + one generic Rust descriptor executor). Then media providers + d3 app layer. Heavy/optional systems (self-healing auto-revise, SemanticIndex, completeness pass) last, each spike-gated.

**Tech Stack:** Vite 8 · React 19 · TypeScript 5.8 (strict, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`) · Tauri 2 (Rust) · Drizzle 0.45 (SQLite via Rust `db_execute`) · Zod 4 · AI SDK `ai@6` + `@ai-sdk/anthropic@3` · TanStack Query 5 · Vitest 4 · `bun` (widget-runtime build).

---

## Execution protocol (READ FIRST — overrides skill defaults)

- **NO COMMITS.** The user reviews before any commit. Implementer subagents must **not** run `git commit`/`git add -A && commit`. They leave changes in the working tree. The controller verifies and presents diffs at wave checkpoints; the user commits.
- **Branch:** all work happens on a dedicated feature branch (created off `main`, no commits) so `git diff main` is a clean review surface and `main` is untouched.
- **Verification gates (every task):** `npx tsc --noEmit` (must stay clean — baseline is clean) **and** `npm test` (baseline 48/48 green). New behavior gets new Vitest tests where logic is testable (pure functions: assembly, parsing, ranking, drift-checks, repos via a db shim). UI/render/stream/Rust paths that can't run headless are verified by typecheck + targeted unit tests + explicit manual-spike notes for the user.
- **Spike protocol (this environment cannot run the Tauri app, live network, Keychain, or Ollama).** Where a spec gates a decision on a runnable spike, implement to the spec's **documented safe v1 fallback** as the default, wire the richer path behind a flag/seam, and write a runnable spike harness (script or test) the user can execute. Spike-gated forks are called out per task. Do **not** invent ad-hoc fallbacks beyond what the specs authorize.
- **House style:** repos are plain exported `const` objects (no classes). `src/core` must import nothing from `src/ui` (the renderer facet is the boundary). New AI generators resolve through `getModelFor`/`getEmbedderFor`, never a hardcoded model. Match existing file aesthetics (e.g. dependency-free SVG in `ChartBlock.tsx`).

---

## Ground-truth corrections (recon vs. spec — implementers MUST honor these)

These are verified deltas between the specs' claims and the real code. Where a spec line/claim conflicts, **reality wins**:

1. **`getModelFor` adoption is partial.** Only the `widget` task uses `getModelFor` (`service.ts`). `lesson`, `intake`, `outline`, `teachback` call the global `getModel()`. The other task ids in `AI_TASKS` are reserved placeholders.
2. **`AiTask` has only `{ id, label, defaultModelId? }`** — no `requiredCapability` anywhere. (Wave 0 adds it.)
3. **`lessonRepo.upsert` is in `lesson.ts:286` inside `generateLesson`**, NOT in `lessonStreams.ts`. `lessonStreams.ts` does TanStack-Query cache ops on the already-persisted row. The "post-stream finalization pipeline" must hook the completion path that wraps `generateLesson`, accounting for this.
4. **`LessonStreamState.status` is `"streaming" | "error"` only** — there is no `"complete"`. Completion is signalled by `setSnapshot(id, null)`.
5. **`jsonTool` structured-output workaround** (`providerOptions.anthropic.structuredOutputMode: "jsonTool"`) is Anthropic-specific and appears in `lesson.ts:137` **and** `teachback.ts:124`. Multi-provider text (Wave 4) must provide a per-provider structured-output strategy; do not assume `jsonTool` works elsewhere.
6. **`concept_links` unique index** is `concept_links_src_tgt` on `(source_concept_id, target_concept_id)` (2 columns). Adding `relation` requires a migration that `DROP`s and re-`CREATE`s the unique index over `(source, target, relation)`. SQLite cannot `ALTER INDEX`.
7. **`ALTER TABLE ... ADD COLUMN` with `NOT NULL` requires a `DEFAULT`** in SQLite. New non-null columns on `lessons` must carry defaults or the migration fails on existing DBs. Prefer nullable + default for json columns.
8. **Widget jobs publish via `queryClient.setQueryData(["widget", c, w], row)` (React Query), NOT `useSyncExternalStore`.** Clone the React-Query publish pattern for `mediaJobs`/`visualJobs`. (`useSyncExternalStore` is only the lesson-stream bridge.)
9. **`BlockRender`** is the real type name in `LessonPane.tsx` (spec says `BlockRenderer`). `renderBlock` is a plain `switch`, not a registry.
10. **`transport.rs` is dead `#[cfg(test)]`-only code.** The real shared HTTP client is the private `fn http()` `OnceLock<reqwest::Client>` inside `ai.rs`. To share it, promote to a `pub(crate)` function in a shared module.
11. **Secret naming is flat** (`"anthropic-api-key"`, `"openrouter-api-key"`), NOT `provider:<id>`. New provider secrets adopt `provider:<id>`; the existing Anthropic/OpenRouter `routes.ts` entries keep their current names (don't break them).
12. **`read_secret` is `pub(crate)` only** — JS can never read a secret back. All authenticated fetches must happen in Rust.
13. **`dirs` crate is absent.** For the media cache dir use Tauri `AppHandle.path().app_cache_dir()` (inject `app: tauri::AppHandle` into the command).
14. **`sqlite-vec` 0.1.9 + `rusqlite` are already in `Cargo.toml`** but not loaded/used anywhere. SemanticIndex's Rust side starts from "load the extension + define the virtual table," not "add the dependency."
15. **`LessonRow` type is not exported** from `repositories.ts` (only `LessonInsert`). Add `export type LessonRow = typeof lessons.$inferSelect;` before cloning the lesson-repo pattern.
16. **Lens lighting is two-step:** register in `src/ui/lenses/registry.ts` (`viz` slot has a `// viz (v2) registers here later` placeholder) AND the generator must emit the lens id in the lesson's `lenses: LensId[]` array. `PreviewPane.tsx` always injects `notes` + `teach`.
17. **Referrer plumbing:** `App.tsx` owns `selectedConceptId`; `onSelectConcept(id)` is the single nav choke point. Capture the outgoing id in a `useRef` there, thread as a `referrer` prop → `LessonPane` → `useConceptLesson` context (currently 7 fields) → `LessonContext`.
18. **Migrations are drizzle-kit-generated SQL files** under `src/core/store/migrations/`, applied at startup via `db_execute`, tracked in `__ascent_migrations`, split on `--> statement-breakpoint`, ordered lexicographically (`000N_slug.sql`). Procedure: edit `schema.ts` → `npx drizzle-kit generate` → the new file applies at next app start. **Verify generated SQL by hand** (esp. the `relation` index drop/recreate, which drizzle-kit may not emit correctly — hand-author that migration if needed).

---

## Shared contracts (pinned once — every wave references these)

### C1. AI tasks + capability (Wave 0, `src/core/ai/tasks.ts`)

```ts
export type AiCapability = "textGeneration" | "embeddings" | "vision";

export interface AiTask {
  id: string;
  label: string;
  defaultModelId?: string;
  requiredCapability?: AiCapability; // default "textGeneration"
}
```

New task ids added together (both specs), each declaring capability + a sensible default tier (tier = an existing default model id string already used in this repo; implementer reads current `AI_TASKS` to match the tier convention):

| id | spec | capability | default tier | purpose |
|---|---|---|---|---|
| `canon` | Continuity B1 | textGeneration | strong | seed + maintain Course Canon |
| `digest` | Continuity B2 | textGeneration | fast (Haiku-class) | per-lesson self-digest |
| `coherence` | Continuity B6 | textGeneration | fast | self-heal drift-check |
| `revise` | Continuity B6 | textGeneration | strong | self-heal rewrite |
| `embed` | Continuity B7 | embeddings | (embedding model) | digest embeddings |
| `director` | Visual §3b | textGeneration | fast (Haiku) | completeness pass |
| `figure` | Visual §4/§9 | textGeneration | fast, Sonnet-bumpable | model-drawn SVG figures |

### C2. Data model additions

**`lessons` += (Wave 1 / Wave 6):** `digest` (text json, nullable), `version` (int, default 1), `revisedAt` (int, nullable), `revisedReason` (text, nullable), `prevSnapshot` (text json, nullable), `stale` (int bool, default 0).

**`course_canon` table (Wave 1):** `topicId` (text PK, FK topics.id), `spine` (text json), `notation` (text json), `motifs` (text json), `voice` (text json), `prereqs` (text json: `Record<conceptId, conceptId[]>`), `version` (int default 1), `updatedAt` (int). `canonRepo` = `{ get, upsert, mergeNotation, placeConcept }` cloning the `widgetRepo` shape.

**`concept_links` += (Wave 7):** `relation` (text, default `'link'`, values `link | builds-on | leads-to`). Migration drops `concept_links_src_tgt` and recreates `UNIQUE INDEX` over `(source_concept_id, target_concept_id, relation)`.

**`media_assets` table (Wave 4):** composite PK `(conceptId, mediaId)`: `kind`, `providerId`, `query`, `status` (`generating|ready|failed`), `localPath`, `width`, `height`, `license` (json), `attribution` (json), `error`, `createdAt`, `updatedAt`. `mediaRepo` = `{ get, upsert, listByConcept }`. Add a delete step to `conceptRepo.removeMany` before the `lessons` step.

**`lesson_embeddings` (Wave 6, sqlite-vec virtual table):** keyed by `conceptId`; populated only when an embeddings provider is enabled.

### C3. `Block` type additions (`src/core/types.ts`, flat optional fields)

Extend the `kind` union with `"timeline" | "figure" | "graph" | "spectrum" | "map" | "media"` and add optional fields: `events?`, `lanes?` (timeline); `figure?: { svg?: string; mediaId?: string }`, `labels?: { text: string; at: { x: number; y: number } }[]` (figure); `nodes?`, `edges?` (graph); `axis?: { min: number; max: number; labels?: string[] }`, `items?: { label: string; at: number }[]` (spectrum); `projection?`, `marks?` (map); `mediaId?`, `query?`, `purpose?` (media); and `alt?: string` on every visual block. The flat shape is for generation/persistence only — renderers/logic narrow via per-kind Zod-`infer` types + guards (`isTimelineBlock(b)`, …), never the mega-interface.

### C4. Domain (`src/core/visuals/catalog.ts`, Wave 2)

```ts
export type Domain =
  | "science" | "math" | "programming" | "history" | "biography"
  | "arts" | "music" | "language" | "law" | "business" | "geography" | "general";
export type VisualKind =
  | "timeline" | "figure" | "graph" | "spectrum" | "map" | "media" | "chart" | "diagram" | "widget";
```

### C5. Visual registry facets (Wave 2) — split so `src/core` stays UI-free

- `src/core/visuals/catalog.ts` — `VisualKindDefinition { id, label, affinity: Domain[], production: "inline"|"job", requiresAltText: true }`; `visualCatalog`.
- `src/core/visuals/authoring.ts` — `VisualPromptDefinition { kind, guidance: string, schema: ZodRawShape }`; `visualAuthoring`. **Lesson prompt's per-kind guidance is assembled from this** (replaces the hand-maintained block in `lesson.ts`); LessonSchema's block-kind fragments merge from this.
- `src/ui/blocks/registry.ts` — `VisualRendererDefinition { kind, isRenderable(b): boolean, render: BlockRender-compatible }`; `visualRenderers`. `renderBlock` dispatches through this (replaces the `switch`).
- `src/core/generation/visualJobs.ts` — `VisualJobDefinition { kind, scan(partial): Intent[], start, resume, retry }`; generalizes `widgetJobs` (the React-Query publish pattern). Only `job`-production kinds (`widget`, `media`, provider-sourced `figure`).

### C6. AI provider registry (Wave 4, `src/core/ai/providers/`)

`types.ts`: `AiProviderMeta { id, label, needsKey, baseUrl?, capabilities: AiCapability[] }`; `TextProvider extends AiProviderMeta { models, languageModel(id): LanguageModelV2 }`; `EmbeddingProvider extends AiProviderMeta { embeddingModels, buildEmbed(texts, id): RequestDescriptor, parseEmbed(body): number[][] }`. `registry.ts`: `providerRegistry { register, list, providersFor(cap), enabled }`, `hasCapability(cap): boolean`. `service.ts`: `getEmbedderFor(task)`. Routing generalizes today's `ascent-route:<task>` to mean a **provider id**; no new settings key.

### C7. Media provider system (Wave 4, `src/core/media/`)

`types.ts`: `MediaKind`, `MediaQuery`, `License`, `MediaResult`, `RequestDescriptor { url, method, headers?, body?, secretAccount? }`, `MediaProviderMeta`, and the separate capability interfaces `SearchableMediaProvider` / `GenerativeMediaProvider` / `EmbeddableMediaProvider` (exactly as spec §6a). `registry.ts`: `providerRegistry { register, list, providersFor(kind), enabled }`. v1 implements **image** kind + **Wikimedia Commons** searchable provider only.

### C8. Shared Rust generic descriptor executor (Wave 4)

Promote `fn http()` from `ai.rs` to a `pub(crate)` shared module (e.g. `src-tauri/src/http.rs`). Add commands in `src-tauri/src/media.rs`: `media_request(descriptor) -> String` and `media_download(app, descriptor) -> { localPath, contentType, width?, height? }` (cache via `app.path().app_cache_dir()`), plus an embeddings executor (`ai_embed(descriptor) -> String` or reuse `media_request`). Each injects the named Keychain secret (`provider:<id>`) in Rust via `read_secret`, mirroring `build_request`. Register all in `lib.rs`. No provider-specific code in Rust.

---

## WAVE 0 — Shared generation seams (do first; works on today's single provider)

*Synthesis step 1. Carves out what both specs build on so neither rewrites `lesson.ts`/`lessonStreams.ts` independently.*

### Task 0.1: Add `requiredCapability` to `AiTask` + register all new task ids

**Files:** Modify `src/core/ai/tasks.ts`; Test `src/core/ai/tasks.test.ts` (create).

- [ ] Read current `AI_TASKS` to learn the exact tier/model-id convention used for `widget`.
- [ ] Add `requiredCapability?: AiCapability` to `AiTask` (import/define `AiCapability` per C1; default treated as `"textGeneration"` at read sites).
- [ ] Add the 7 new task ids from C1 with appropriate `defaultModelId` tiers and `requiredCapability`.
- [ ] Test: every task has a unique id; `embed` declares `"embeddings"`; resolving a default capability yields `"textGeneration"`.
- [ ] Verify: `npx tsc --noEmit` clean; `npm test` green. **No commit.**

**Acceptance:** existing tasks unchanged in behavior; new ids present; capability defaulting helper exists and is unit-tested.

### Task 0.2: Route lesson generation through `getModelFor("lesson")`

**Files:** Modify `src/core/generation/lesson.ts` (the `getModel()` call site for lesson gen) and `src/core/ai/service.ts` if `getModelFor` needs a capability-aware no-op today.

- [ ] Replace the lesson generator's `getModel()` with `getModelFor("lesson")`. For Anthropic-only users (today's n=1) the resolved model must be identical to before (confirm via the existing route/model localStorage keys + default).
- [ ] Ensure usage attribution still records `task: "lesson"` (it already keys on task when routed through `getModelFor`).
- [ ] Test: `getModelFor("lesson")` with no override resolves to the same default model id as `getModel()` did (unit test with a mocked settings/route layer, matching how `widget` is tested if such a test exists).
- [ ] Verify: `tsc` clean; tests green. **No commit.**

**Acceptance:** zero behavior change for Anthropic-only; lesson spend now attributed to the `lesson` task.

### Task 0.3: Extract lesson prompt + schema assembly into a composable seam

**Files:** Create `src/core/generation/lessonPrompt.ts`, `src/core/generation/lessonSchema.ts`; Modify `src/core/generation/lesson.ts`; Test `src/core/generation/lessonPrompt.test.ts`, `lessonSchema.test.ts`.

This is the load-bearing refactor. Today `lesson.ts` hand-assembles the prompt (including a per-kind visual-guidance wall) and defines `LessonSchema` inline. Extract both into assembly functions that compose from ordered fragments, so:
- Visual registry (Wave 2) contributes per-kind `guidance` + `schema` fragments via `visualAuthoring`.
- Continuity (Wave 1) contributes continuity prompt sections (canon/digests/handoff) without touching the visual fragments.

- [ ] Move the prompt construction into `buildLessonPrompt(ctx, opts)` in `lessonPrompt.ts`, composed from named sections (intro, format rules, existing per-kind visual guidance verbatim for now, continuity placeholder hook, output instruction). Behavior identical to today (snapshot/string-equality test against the current prompt for a fixed `LessonContext`).
- [ ] Move `LessonSchema` into `buildLessonSchema(fragments?)` in `lessonSchema.ts`; default fragments reproduce today's schema exactly (parse a known-good lesson JSON → unchanged).
- [ ] `lesson.ts` calls the two builders; keep the `jsonTool` Anthropic structured-output path exactly as-is (ground-truth #5).
- [ ] Tests: golden-string test that `buildLessonPrompt` for a fixed context equals the pre-refactor prompt; `buildLessonSchema().safeParse(knownLesson)` succeeds; an added fragment appears in prompt + schema.
- [ ] Verify: `tsc` clean; `npm test` green (esp. any existing lesson tests). **No commit.**

**Acceptance:** `lesson.ts` is thinner; prompt + schema are assembled from fragments; output byte-identical for the no-fragment case.

### Task 0.4: One ordered post-stream finalization pipeline

**Files:** Create `src/core/generation/finalization.ts`; Modify `src/core/generation/lesson.ts` (around the `lessonRepo.upsert` at ~:286) and/or `lessonStreams.ts` completion path; Test `finalization.ts` test.

Both specs want post-stream work after the final lesson upsert. Build one ordered, registerable pipeline so Continuity (digest → canon merge) and Visual (completeness scan, media job scan) and the existing widget scan run in a defined order, off the streaming critical path, never racing the upsert.

- [ ] Define `registerFinalizationStep(step: { name; run(ctx): Promise<void> | void })` and `runFinalization(ctx)` where `ctx` carries `{ concept, topicTitle, path, lesson (persisted), blocks }`.
- [ ] Wire the existing final `scanForWidgetJobs(..., true)` as the first registered step (behavior unchanged).
- [ ] Call `runFinalization` exactly once after the final `lessonRepo.upsert` completes (account for ground-truth #3: upsert is in `lesson.ts`; the finalization must run after generation resolves, not inside the stream). Guard against double-run.
- [ ] Test: steps run in registration order; a throwing step doesn't abort siblings (logged, isolated); widget-scan step still fires.
- [ ] Verify: `tsc` clean; tests green; manually confirm (typecheck-level) the widget flow is unchanged. **No commit.**

**Acceptance:** widget scanning still works via the pipeline; Continuity/Visual can register steps without touching the stream.

### Task 0.5: Export `LessonRow`

**Files:** Modify `src/core/store/repositories.ts`.

- [ ] Add `export type LessonRow = typeof lessons.$inferSelect;`.
- [ ] Verify: `tsc` clean. **No commit.**

**WAVE 0 CHECKPOINT:** `tsc` clean, `npm test` green, lesson generation behaviorally unchanged for Anthropic-only. Present diff.

---

## WAVE 1 — Continuity core / the felt win (Continuity B1–B4, B8 bands)

*Synthesis step 2. Biggest felt product improvement; works on today's single provider. Run spike #3 (cohesion lands) conceptually here — see spike harness task 1.8.*

### Task 1.1: `lessons` digest + versioning columns (migration)
**Files:** Modify `src/core/store/schema.ts`; generate migration `src/core/store/migrations/000N_lesson_continuity.sql` (verify by hand per ground-truth #7/#18); Modify `repositories.ts` (`LessonInsert`/`LessonRow` pick up new cols automatically).
- [ ] Add C2 `lessons` columns (all nullable / defaulted). Generate + hand-verify SQL (NOT NULL needs DEFAULT; prefer nullable json).
- [ ] Verify: `tsc` clean; tests green; (manual note) migration applies on a fresh + existing DB. **No commit.**

### Task 1.2: `course_canon` table + `canonRepo`
**Files:** Modify `schema.ts`; migration `000N_course_canon.sql`; Modify `repositories.ts` (clone `widgetRepo` shape → `canonRepo` with `get/upsert/mergeNotation/placeConcept`); Test `repositories` canon test (db shim).
- [ ] Define table per C2; `canonRepo.mergeNotation` does field-level append (not whole-row replace) per spec concurrency note; `placeConcept` updates spine ordering + prereqs for a new concept.
- [ ] Test merge appends notation without clobbering existing; place adds a concept to prereqs/spine.
- [ ] Verify. **No commit.**

### Task 1.3: `canon.ts` — seed Course Canon after intake+outline
**Files:** Create `src/core/generation/canon.ts`; Modify intake/outline completion to seed canon once; Test canon-prompt assembly.
- [ ] `seedCanon(topicId, intakeBrief, outline)` builds spine + notation + motifs + voice + prereq graph via `getModelFor("canon")` (strong). Prereq graph reasons over titles+summaries (the `existingConcepts` shape) — no embeddings.
- [ ] `placeForkedConcept(...)` cheap call to slot a new forked concept into spine + prereqs (called from finalization/fork path).
- [ ] Test: prompt includes outline concepts; parser handles a known canon JSON.
- [ ] Verify. **No commit.** *(Spike #2 — canon authoring quality — is a manual harness; see 1.8.)*

### Task 1.4: `digest` task + finalization step (Lesson Digest B2)
**Files:** Create `src/core/generation/digest.ts`; register a finalization step (Task 0.4) that runs the digest then merges canon; Test digest parse + canon-merge wiring.
- [ ] `generateDigest(lesson)` via `getModelFor("digest")` (fast) → `LessonDigest` (recap, motifs, notation, openLoops, deferredTo, assumedPrereqs); writes the `lessons.digest` column (whole-row upsert preserves other fields).
- [ ] After writing digest, call `canonRepo.mergeNotation` + motif update (B1 living-canon write-back), last-writer-wins on the single row, AFTER upsert (never in stream).
- [ ] Register as finalization step ordered after the widget scan; off the render critical path (lesson renders before digest exists).
- [ ] Test: digest parse; merge invoked with digest notation.
- [ ] Verify. **No commit.**

### Task 1.5: Rewrite `LessonContext` to carry continuity (B3)
**Files:** Modify `src/core/generation/lesson.ts` (`LessonContext` type), `src/core/generation/lessonPrompt.ts` (consume new fields), `src/ui/LessonPane.tsx` (assemble new fields ~:348–366), `src/App.tsx` + `src/ui/AppShell.tsx`/`LessonPane.tsx` (referrer plumbing per ground-truth #17); Test context assembly.
- [ ] Add to `LessonContext`: `canon` slice, `ancestorDigests`, `siblingDigests`, `referrer`, `prereqDigests`, `learnerState` (learnerState filled in Wave 6; nullable now). Keep broad `existingConcepts` as title+summary (token discipline).
- [ ] Plumb `referrer` (previous concept id) from `App.tsx` `useRef` → `LessonPane` prop → `useConceptLesson` 8th field → `LessonContext`.
- [ ] Assemble digests for lineage + immediate neighbors + prereqs + referrer only (bounded set); missing neighbors → fewer digests (graceful, preserves arbitrary-order).
- [ ] Test: assembly includes ancestor/sibling/referrer digests when present; degrades when absent.
- [ ] Verify. **No commit.**

### Task 1.6: Handoff authoring prompt (B4 — the hero)
**Files:** Modify `src/core/generation/lessonPrompt.ts` (continuity section); Test prompt content.
- [ ] Add continuity guidance: open by bridging from `referrer`/parent; use canonical notation; precise grounded back-references (only from injected digests/canon — never invent, per DIRECTIVE); close open loops; hand off forward (`suggestedForks` as promises, `suggestedLessons` as "next on the path"). Keep all existing format rules; continuity is additive.
- [ ] Test: when digests/canon are injected, prompt contains grounded-reference instruction + the injected material; when absent, no continuity section (falls back to today).
- [ ] Verify. **No commit.**

### Task 1.7: "Previously / Up next" bands (B8 light UI)
**Files:** Create `src/ui/blocks/ContinuityBands.tsx` (or in `LessonPane`); Modify `LessonPane.tsx` to render top/bottom bands from digests + canon + `suggestedForks`/`suggestedLessons`; Test (render-logic unit where feasible).
- [ ] Top band: recap referrer/parent with a clickable source chip → navigate. Bottom band: forward-promise chips (`suggestedForks` framed "where this leads" + `suggestedLessons` links). Pure render of data already computed. No arc rail.
- [ ] Verify: `tsc` clean; tests green; manual-view note for the user. **No commit.**

### Task 1.8: Spike harnesses (manual, for the user) — #2 canon quality, #3 cohesion lands
**Files:** Create `docs/superpowers/spikes/continuity-spikes.md` + optional runnable scripts under `scripts/spikes/`.
- [ ] Document + script: generate canon from the ML demo outline (#2); A/B a few lessons with vs without continuity context+handoff (#3); checklist for "precise refs, no re-motivation, no hallucinated references."
- [ ] These run against live models (user executes). **No commit.**

**WAVE 1 CHECKPOINT:** `tsc`/`tests` green; continuity context + handoff + bands in place; canon + digests persist. Present diff + spike harness for the user to validate cohesion.

---

## WAVE 2 — Native visual registry + timeline/spectrum (Visual §2, §3a, §4 timeline/spectrum)

*Synthesis step 3 (foundation + coverage-thesis validators). Smallest surface that proves the registry end-to-end and that prompting lifts non-STEM coverage.*

### Task 2.1: `Domain` + `VisualKind` types + per-topic domain inference
**Files:** `src/core/visuals/catalog.ts` (types per C4), inference helper (cheap, per topic/concept, reused — not a per-lesson model call); Test inference mapping.

### Task 2.2: Visual catalog + authoring facets
**Files:** `src/core/visuals/catalog.ts` (`visualCatalog`), `src/core/visuals/authoring.ts` (`visualAuthoring`); register existing kinds (`chart`, `diagram`, `widget`) + new `timeline`, `spectrum` with `guidance` + Zod `schema` fragments + `affinity`; Test.

### Task 2.3: Wire authoring into the prompt/schema seam (Wave 0)
**Files:** Modify `lessonPrompt.ts` + `lessonSchema.ts` to assemble per-kind guidance + schema fragments from `visualAuthoring` (replaces the hand-maintained wall); Test that timeline/spectrum guidance + schema appear.

### Task 2.4: `timeline` + `spectrum` block types + renderers
**Files:** Modify `src/core/types.ts` (C3 fields + guards `isTimelineBlock`/`isSpectrumBlock`); Create `src/ui/blocks/TimelineBlock.tsx`, `SpectrumBlock.tsx` (dependency-free SVG, ChartBlock aesthetic, alt text); Test guards + render-logic.

### Task 2.5: Renderer registry facet + `renderBlock` dispatch
**Files:** Create `src/ui/blocks/registry.ts` (`visualRenderers` per C5); Modify `LessonPane.tsx` `renderBlock` to dispatch through it (replace the `switch`; keep plain-prose kinds inline); Test dispatch.

### Task 2.6: Domain-aware visual budget (§3a, prompt-time)
**Files:** Modify `lessonPrompt.ts` to inject a domain budget ("reach for these unless content resists") from `visualCatalog` affinity; Test budget text per domain.

### Task 2.7: Spike #5 harness (planner coverage uplift)
**Files:** `docs/superpowers/spikes/visual-spikes.md` — A/B non-STEM lessons with vs without the budget; measures whether 3b (Wave 7) is needed.

**WAVE 2 CHECKPOINT:** registry live; timeline/spectrum render; domain budget in prompt; coverage spike ready. Present diff.

---

## WAVE 3 — `figure` (vector) + d3 app layer (`graph`, `map`) (Visual §4, §7, §8)

### Task 3.1: `figure` block (vector-first) + `figure` task
**Files:** types + guard + `src/ui/blocks/FigureBlock.tsx` (SVG scene + leader-line labels + alt/`<desc>`); authoring fragment; `figure` task via `getModelFor`. Spike #2 (freeform vs constrained schema) harness.

### Task 3.2: d3 dependencies (lazy)
**Files:** `package.json` — add `d3-scale d3-shape d3-array d3-hierarchy d3-force d3-geo topojson-client world-atlas` (submodules, lazy-loaded chunks like katex/mermaid). Verify install + `tsc`.

### Task 3.3: `graph` block (d3-force/hierarchy, model emits data)
**Files:** types + guard + `src/ui/blocks/GraphBlock.tsx` (app-side d3, model emits `nodes`/`edges`); authoring fragment; Test guard.

### Task 3.4: `map` block (d3-geo + bundled TopoJSON)
**Files:** types + guard + `src/ui/blocks/MapBlock.tsx` (d3-geo + `world-atlas` TopoJSON; model emits marks, never geometry); authoring fragment. Spike #3 (bundle weight, lazy-load) harness.

**WAVE 3 CHECKPOINT:** figure/graph/map render via registry; d3 lazy-loaded; bundle-weight spike ready. Present diff.

---

## WAVE 4 — Shared provider / Sources infrastructure (Continuity Part A + Visual §6)

*Synthesis step 4. Build once for both specs.*

### Task 4.1: Promote Rust `http()` to a shared `pub(crate)` module
**Files:** Create `src-tauri/src/http.rs` (move `http()` from `ai.rs`, `pub(crate)`); Modify `ai.rs` to use it; `lib.rs` `mod http;`. Verify `cargo check` (note for user if cargo unavailable here).

### Task 4.2: Generic Rust descriptor executors (media + embeddings)
**Files:** Create `src-tauri/src/media.rs` (`media_request`, `media_download(app, …)` per C8 + ground-truth #13); embeddings executor (`ai_embed` or reuse `media_request`); Register in `lib.rs`. Secret injection via `read_secret` mirroring `build_request`. No provider-specific code.

### Task 4.3: AI provider registry + types + capability gating
**Files:** `src/core/ai/providers/types.ts` + `registry.ts` (C6); `hasCapability`; `getEmbedderFor` in `service.ts`; generalize `ascent-route:<task>` to provider id (no new key). Add OpenAI/Google/Ollama/Voyage metas (text + embeddings). Tests for `providersFor`/`hasCapability`/routing-resolves.

### Task 4.4: Media provider registry + Wikimedia adapter (image only)
**Files:** `src/core/media/types.ts` + `registry.ts` (C7); `src/core/media/providers/wikimedia.ts` (`buildSearch`/`parseSearch`/`buildFetch`, pure TS); Tests for build/parse against captured Wikimedia JSON fixtures.

### Task 4.5: Settings "Sources" UI (shared AI + media providers)
**Files:** Settings component(s) — one "Sources" section: provider rows (enable toggle, key field if `needsKey` → `secretStore` `provider:<id>`, base-URL if local, capabilities/kinds shown). Ollama row `needsKey:false` + editable base URL. Non-secret options in localStorage.

### Task 4.6: Capability gating wiring
**Files:** gate embeddings-dependent features (SemanticIndex) + media features on `hasCapability`/enabled providers; quiet "configure a provider for X" nudge; never hard-crash. Spike #1 (Wikimedia round-trip), A7.1 (multi-provider text + structured output), A7.2/#4 (Ollama) harnesses.

**WAVE 4 CHECKPOINT:** providers configurable; Rust executors registered; Wikimedia adapter parses fixtures; capability gating in place. Present diff + spike harnesses.

---

## WAVE 5 — Media providers live + sandbox d3 + provider-sourced figures (Visual §5, §6c, §6e)

### Task 5.1: `media_assets` table + `mediaRepo` + cascade-delete step
### Task 5.2: `mediaJobs` registry (clone `widgetJobs` React-Query pattern) — resolve `media` placeholders → search → rank (license-first) → fetch → cache → row
### Task 5.3: `media` block + `figure` provider-sourced path (renderer: `<img>` from local cache, never inline remote SVG; visible attribution; sandboxed for future embeds)
### Task 5.4: `media` visual-job facet in `visualJobs`; finalization media scan step
### Task 5.5: Sandbox d3 in widget runtime (`src/widget-runtime/runtime.ts` bundle add) + spike #4 (srcdoc size) harness

**WAVE 5 CHECKPOINT:** media resolves+caches with attribution; sandbox d3 measured. Present diff.

---

## WAVE 6 — Continuity learner-adaptivity + self-healing + SemanticIndex (B5, B6, B7)

### Task 6.1: Inject `learnerState` (B5) — per-prereq mastery + open teach-back gaps into `LessonContext` + prompt (mastered → callback; weak → built-in refresher). Re-tailor policy: mark dependent lessons `stale` only on material threshold (mastery Δ≥0.2 or gap closes).
### Task 6.2: Self-healing `coherence.ts` (B6) + job registry (mirror lessonStreams/widgetJobs). Drift-check (`coherence` task, fast) on digests; **spike #1 (continuity) gates auto-revise** → default to **detect-and-flag-only**; wire `revise` (strong) behind the flag. Versioning columns (Task 1.1) + "auto-revised" badge + one-step diff/revert (`prevSnapshot`). Never run while target is streaming (`isLessonStreaming`).
### Task 6.3: SemanticIndex (B7) — load `sqlite-vec` in Rust (crate present, ground-truth #14) + `lesson_embeddings` virtual table; embed digests via `getEmbedderFor("embed")`; top-k retrieve adds to `prereqDigests`. Gated on `embeddings` capability — dormant otherwise (canon prereqs are the floor).

**WAVE 6 CHECKPOINT:** adaptivity + flag-only self-heal + gated semantic retrieval. Present diff.

---

## WAVE 7 — Completeness pass + typed edges + viz lens + revised badge polish (Visual §3b, §8; Continuity B8 edges)

### Task 7.1: Completeness pass (§3b, `director` task) — **append-only** after final upsert (DIRECTIVE: no mid-array insert). **Gated on spike #5** — ship only if the budget alone left gaps; else keep 3a and drop 3b.
### Task 7.2: `concept_links.relation` migration (drop+recreate unique index over 3 cols, ground-truth #6) + populate typed edges (`builds-on`/`leads-to`) from canon prereqs + SemanticIndex; feed the planned ⌘G graph.
### Task 7.3: `viz` lens — register in `src/ui/lenses/registry.ts` + generator emits `"viz"` in `lenses` when ≥1 visual beyond prose (ground-truth #16). Gallery/enlarge + media attribution detail.

**FINAL CHECKPOINT:** full combined scope; `tsc`/`tests` green; final code-review pass; present complete diff for the user's review + commit.

---

## Self-review (against both specs)

- **Continuity coverage:** A1–A7 → Wave 0.1–0.2, Wave 4.3/4.6 (+ spikes). B1 canon → 1.2/1.3; B2 digest → 1.4; B3 context → 1.5; B4 handoff → 1.6; B5 adaptivity → 6.1; B6 self-heal → 6.2; B7 SemanticIndex → 6.3; B8 bands/edges/badge → 1.7, 7.2, 6.2. Data model → 1.1/1.2/7.2 + 4.x. ✔
- **Visual coverage:** §1 architecture → Wave 2 registry; §2 facets → 2.2/2.5/4/5.4; §3a budget → 2.6; §3b completeness → 7.1; §4 blocks → 2.4/3.1/3.3/3.4/5.3; §5 sandbox d3 → 5.5; §6 media → 4.4/4.5/5.x; §7 d3 → 3.2; §8 viz lens → 7.3; §9 tasks → 0.1; §10 data model → C2/C3 + migrations; §11 spikes → 1.8/2.7/3.x/4.6/5.5. ✔
- **Collision points (synthesis):** `lesson.ts` → 0.3 extraction; `lessonStreams.ts`/finalization → 0.4; `LessonSchema`/`Block` → owned by visual registry (2.3); Settings/Sources → 4.5 shared; Rust executor → 4.1/4.2 shared; `AI_TASKS` → 0.1 added together; `concept_links` unique index → 7.2. ✔
- **No placeholders of intent:** near-term waves (0–1) fully task-stepped; Waves 2–7 are scoped task lists with pinned contracts, to be expanded to full bite-sized steps just-in-time before each wave executes (each wave is independently testable). Far-future full-code is intentionally deferred to avoid stale detail, not omitted.
