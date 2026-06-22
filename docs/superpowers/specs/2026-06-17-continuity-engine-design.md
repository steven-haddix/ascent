# Continuity Engine — Design

**Date:** 2026-06-17
**Status:** Approved direction (whole-vision design; one combined spec = AI Provider & Capability Registry + Continuity Engine). Decisions locked in brainstorming: the lesson's **own prose is the primary lever** (UI is secondary), **full self-healing** (lessons mutable after birth), **full learner-adaptivity** (lessons tailor to mastery/teach-back), surfaced UI = the **"Previously / Up next" bands** only (no arc rail). Build order by dependency/risk, not phased gating.

## Goal

Lessons cohere at the **macro** level (the title tree is a sensible map) but feel like **islands** at the **micro** level: moving from one lesson to the next doesn't feel like it builds on what came before. This is structural, not a prompt-quality fluke. Every lesson is generated **amnesiac** — the only cross-lesson signal the generator receives is neighbor **titles + one-line summaries** plus the ancestor breadcrumb (`LessonContext` in `src/core/generation/lesson.ts`, assembled at `src/ui/LessonPane.tsx:348`). It never sees a single sentence of what any other lesson actually taught. So each lesson re-motivates from zero, re-picks its own analogy, re-introduces notation under a fresh symbol, and starts a new example.

The user's refinement narrowed the target: the felt gap is **"lessons don't build on each other"** — a *narrative continuity* problem — and the **primary lever is the lesson's own words**, not UI chrome. The "Previously / Up next" bands are a welcome, light surface, not the mechanism.

The fix is a **shared, living course memory** that every on-demand generation reads from and writes back to, plus an **authoring discipline** that makes each lesson pick up the thread and hand off forward. On-demand, lazy, arbitrary-order generation is preserved exactly — we are adding memory, not a global pre-pass.

The work has two halves, combined here by request:

- **Part A — AI Provider & Capability Registry** (foundation). Generalizes today's Anthropic-only model routing into **capability-aware, multi-provider** routing — many BYO keys, plus local keyless providers (Ollama). Features gate on *capabilities* (text generation, embeddings): a feature lights up only if some configured provider can do what it needs. This is the AI-side sibling of the **media provider system** already approved in `2026-06-17-visual-learning-system-design.md` (§6) and reuses its conventions wholesale.
- **Part B — The Continuity Engine** (the cohesion payload). Course Canon + Lesson Digests + continuity context + handoff authoring + learner-adaptivity + self-healing + the light UI, with a **capability-gated SemanticIndex** sitting on Part A.

Constraint correction (was wrong in prior notes): the binding constraint is **local-first / no backend yet** (open source), *not* "Anthropic only." Provider/key handling must be genuinely multi-provider from day one.

---

# Part A — AI Provider & Capability Registry

## A1. Capabilities, not providers

A **provider** is an AI backend (Anthropic, OpenAI, Google, Ollama, Voyage, …). Each provider declares the **capabilities** it supports and is configured with credentials (or none, for local). A **task** declares the capability it needs; routing resolves to a *configured + capable* provider. A capability with no configured provider hides or degrades the feature that needs it. Anthropic-only is just the **n = 1** case of this model — nothing about today's behavior regresses.

This mirrors the media provider system exactly (`visual-learning §6`): capabilities are **separate interfaces** (a provider implements only what it does, avoiding a lowest-common-denominator shape), secrets live in the Keychain keyed `provider:<id>`, and the network boundary is the proven descriptor → Rust executor.

## A2. Capability model — types (`src/core/ai/providers/types.ts`)

```ts
type AiCapability = "textGeneration" | "embeddings" | "vision"; // extensible

interface AiProviderMeta {
  id: string;            // "anthropic" | "openai" | "google" | "ollama" | "voyage" | ...
  label: string;
  needsKey: boolean;     // false for local (Ollama) → no Keychain secret
  baseUrl?: string;      // configurable for local/self-hosted (Ollama default :11434)
  capabilities: AiCapability[];
}

// Capabilities are SEPARATE interfaces — a provider implements only what it does.
interface TextProvider extends AiProviderMeta {
  models: ModelInfo[];                       // catalog for textGeneration (id, label, tier)
  languageModel(modelId: string): LanguageModelV2;  // an AI SDK model instance
}
interface EmbeddingProvider extends AiProviderMeta {
  embeddingModels: ModelInfo[];
  buildEmbed(texts: string[], modelId: string): RequestDescriptor; // pure-TS; Rust executes
  parseEmbed(body: unknown): number[][];
}
```

`languageModel()` returns an AI SDK v6 model (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `ollama-ai-provider`), so `streamText`/`generateText`/`Output.object` are untouched — only model *resolution* changes. `EmbeddingProvider` uses the **descriptor → Rust** boundary (A6) rather than an SDK call, so a 40-provider future is cheap and keys never enter JS.

DIRECTIVE: `textGeneration` keeps flowing through the AI SDK + Rust `ai_request`/`ai_stream` (`src-tauri/src/ai.rs`); embeddings flow through a new generic Rust executor (A6). No provider-specific code in Rust.

## A3. Registry + configuration (`src/core/ai/providers/registry.ts`)

A `providerRegistry` analogous to the media `providerRegistry`: `register(p)`, `list()`, `providersFor(capability)`, `enabled()`. Enabled providers + non-secret options (base URLs, selected models) live in settings (localStorage, like the rest of settings); **secrets live in the macOS Keychain** via the existing `secretStore` (`src/core/secrets.ts`, `src-tauri/src/secrets.rs`) keyed `provider:<id>` — the exact pattern the Anthropic key already uses and that the media spec adopts.

**Settings: one shared "Sources" / providers surface.** The AI providers and the media providers (visual-learning §6b) should render in the **same Settings "Sources" section** — both are "configure a provider, optionally add a key." A provider row shows: enable toggle, key field (if `needsKey`), base-URL field (if local/self-hosted), and which capabilities it unlocks. Ollama appears as `needsKey: false` with an editable base URL.

DIRECTIVE: never put a provider key in JS/localStorage; provider secrets go through `secretStore` (Keychain), provider network calls go through Rust. Same rule as media.

## A4. Capability-aware task routing (generalize `tasks.ts` / `getModelFor`)

Today `src/core/ai/tasks.ts` maps task → optional default model, and `getModelFor(task)` (`src/core/ai/service.ts:180`) resolves a model for the global/overridden Anthropic setup. Generalize:

- Each `AiTask` gains a `requiredCapability: AiCapability` (default `"textGeneration"`).
- `getModelFor(task)` resolves: the user's per-task override via the **existing** `ascent-route:<task>` / `ascent-model:<task>` keys (`getTaskRouteId`/`getTaskModelId`, established by the widget task) — where a **route now resolves to a provider id** in the multi-provider model, generalizing today's single-provider "route" — → else the task's default → else the global default provider → validated against a provider that is **configured and capable**. Returns an AI SDK model instance. No new settings key is introduced; `route` simply gains provider meaning.
- New `getEmbedderFor(task)` resolves an `EmbeddingProvider` the same way for embedding tasks.
- The resolved provider+model id is passed to `recordingMiddleware` (usage tracking already keys on task — `src/core/store/schema.ts:184`), so per-provider/per-use-case spend stays attributed.

Migration policy continues the one already written in `tasks.ts:6`: existing `getModel()` call sites keep working (they resolve to the default text provider); use cases migrate to `getModelFor` as each earns a knob. Anthropic-only users see zero change.

## A5. Graceful capability gating

A single helper — `hasCapability(cap): boolean` (any enabled+configured provider offers it) — drives feature gating:

- **No `embeddings` provider** → the SemanticIndex (B7) is dormant; cohesion falls back to the canon-authored prerequisite graph (B1). No error, no dead UI.
- **A task's preferred provider is unconfigured** → fall back to any configured+capable provider; if none, surface a quiet "Configure a provider for X" nudge in the relevant surface (matches media's offline-graceful rule).
- Features never hard-crash on a missing capability; the lesson/prose path always works with the single default text provider.

## A6. Embeddings network boundary (`src-tauri/src/ai.rs` or a sibling)

Embeddings reuse the **generic descriptor executor** the media spec defines (§6d) rather than inventing a parallel path: a Rust command takes a `RequestDescriptor`, injects the named Keychain secret (`provider:<id>`), runs the request via the shared client (`src-tauri/src/transport.rs`), and returns the body for the TS adapter to parse. For **Ollama**, the same executor hits `http://localhost:11434/api/embeddings` with no secret. This keeps CORS, auth, and one auditable network surface in Rust; **adding an embedding provider is a pure-TS adapter, zero Rust.**

## A7. Spikes (Part A)

1. **Multi-provider text swap.** Drive one lesson generation through a non-Anthropic provider (OpenAI or Google via its AI SDK adapter) behind `getModelFor("lesson")` — confirm `streamText` + `Output.object` + the `jsonTool` structured-output path behave (the `jsonTool` workaround is Anthropic-specific; other providers may need their own structured-output mode). **This gates calling routing "multi-provider."**
2. **Ollama round-trip through Rust.** Local text generation and local embeddings (`nomic-embed-text` or similar) via the descriptor executor — no key, editable base URL, graceful "Ollama not running" failure.

---

# Part B — The Continuity Engine

## B1. Shared memory — the Course Canon (living)

A per-topic **Course Canon**: the shared spine, conventions, and cross-tree dependency map that every lesson conforms to. New `src/core/generation/canon.ts`; new `course_canon` table (one row per topic).

**Seeded** once right after intake + outline (we already have the outline structure and the intake brief there — see `src/core/generation/intake.ts` / `outline.ts`). Contents:

- **`spine`** — the narrative arc of the topic and of each major branch ("feel the problem → simplest thing that works → watch it break → earn each fix"), as short prose + an ordered list of the outline's concepts. Gives every lesson a sense of where it sits.
- **`notation`** — canonical symbols/terms registry (`{ symbol, means, firstIntroducedIn? }`), so $\theta$ is $\theta$ everywhere.
- **`motifs`** — 1–3 designated through-lines and the spine example(s) that evolve across lessons.
- **`voice`** — tone, depth, pacing charter (one author, not a committee).
- **`prereqs`** — a **prerequisite graph**: `conceptId → conceptId[]` of what it builds on, authored by the model over the outline. This expresses cross-tree "builds on" that tree containment cannot, and needs **no embeddings** (the model reasons over titles+summaries, exactly the `existingConcepts` list it already gets).

**Living.** The canon is seeded as a *plan* and then enriched by reality:

- When a lesson's digest (B2) reports new notation / a new motif / a closed-or-opened loop, those are merged back into the canon (notation registry grows; motifs gain "last advanced in <concept>").
- When the tree **forks** (a new concept is created from a lesson), a cheap call places the new node in the spine ordering and assigns its prereqs. This keeps the canon coherent as the tree grows on demand.
- Concurrency: canon write-backs are **last-writer-wins merges on the single `course_canon` row**, performed *after* a lesson upsert completes (never inside the streaming path), so they cannot race the lesson stream (same race-avoidance discipline as the `widgets` table).

`canonRepo` (get/upsert/mergeNotation/placeConcept) follows the existing repo pattern (`src/core/store/repositories.ts`).

## B2. Shared memory — the Lesson Digest

A compact, structured summary of what a lesson actually established. Stored as a `digest` JSON column on the existing `lessons` row (1:1 with the lesson; no new table needed — it is written in the same lifecycle as the lesson and read alongside it).

```ts
interface LessonDigest {
  recap: string;            // 1-2 sentences: what the learner knows after this lesson
  motifs: string[];         // analogies / mental models introduced (e.g. "loss surface as terrain")
  notation: { symbol: string; means: string }[];  // symbols/terms this lesson pinned down
  openLoops: string[];      // questions raised but deliberately not answered here
  deferredTo: string[];     // sub-topics this lesson explicitly leaves to deeper lessons
  assumedPrereqs: string[]; // concepts this lesson built on (titles or handles)
}
```

**Produced by a separate cheap call (the `digest` task), NOT inside `LessonSchema`.** Rationale (decisive): `LessonSchema` already stalls Anthropic native structured output and runs in `jsonTool` mode (M8 gotcha #1) — adding a six-field object risks the streaming path. A post-generation digest call takes the just-persisted lesson as input, runs on a fast model, and writes the `digest` column + triggers the canon merge (B1). It is off the streaming critical path; the lesson renders before its digest exists. This decouples a fragile schema from the memory layer and keeps the prose path stable.

Timing: the digest is generated in `ensureLessonStream`'s completion handler (`src/core/generation/lessonStreams.ts`), after `lessonRepo.upsert`, alongside the existing `scanForWidgetJobs(..., true)` final pass.

## B3. Continuity context — rewrite `LessonContext`

Replace the titles+summaries context with continuity-bearing memory. `LessonContext` gains:

- **`canon`** — the slice this lesson needs: spine position (what comes before/after on the arc), relevant notation, voice charter, and **this concept's prereqs**.
- **`ancestorDigests`** — digests of the path lineage (the conceptual backbone of "building on").
- **`siblingDigests`** — digests of already-generated siblings ("unlike X, which we covered…").
- **`referrer`** — the lesson the learner **navigated from** (often, but not always, the parent), so lateral moves (sibling→sibling, link-following) bridge too. Requires the UI to pass the previous concept id into the context (small plumbing in `AppShell.tsx` navigation + `LessonPane.tsx:358`).
- **`prereqDigests`** — digests of the concept's canon-declared prerequisites, even across branches.
- **`learnerState`** — see B5.

**Token discipline (deliberate boundary).** Full digests are injected only for the **lineage + immediate neighbors + prereqs + referrer** — a bounded set. The broad `existingConcepts` list stays **title + summary** as today (it exists for link resolution in `suggestedLessons`, not deep continuity). Digests are small by construction, so even a deep path stays cheap; this never grows with total tree size, only with local neighborhood size.

A lesson generated before its neighbors exist simply gets fewer digests and falls back toward today's behavior — on-demand and arbitrary-order are preserved. Note the strong guarantee: a **forked child's parent always already exists** (you fork from a lesson you are reading), so the dominant parent→child motion always has an ancestor digest.

## B4. Handoff authoring — the hero (`src/core/generation/lesson.ts` prompt)

This is the change the learner actually *feels*; B1–B3 exist to make it possible. Rebuild the lesson prompt around continuity:

- **Open by bridging.** Begin from where the learner came (`referrer`/parent) — pick up the thread, never restart the topic or re-motivate the whole subject. ("You just saw the loss surface as terrain; now we descend it.")
- **Use the canon.** Canonical notation from the registry; reuse motifs and advance the spine example rather than inventing a new one.
- **Precise back-references.** Reference specific prior lessons by name where it genuinely helps ("the gradient we met in Optimization"), drawn from `ancestorDigests`/`prereqDigests` — not vague "as we discussed."
- **Close open loops.** If an ancestor's digest lists an `openLoop` this lesson answers, close it explicitly.
- **Hand off forward.** Frame `suggestedForks` as promises a child lesson will honor; phrase `suggestedLessons` as "next on the path."
- Keep all existing format rules (8–14 blocks, terms, callouts, code/visual blocks). Continuity guidance is additive.

DIRECTIVE: continuity references must be grounded in injected digests/canon — the prompt must instruct the model to reference only what it was given, never invent a prior lesson. (Hallucinated back-references are worse than none; the self-healing pass B6 also catches dangling refs.)

## B5. Learner-adaptive continuity (full)

Cohesion is personalized to *this* learner's demonstrated understanding — unique to Ascent because mastery + teach-back gaps already exist (`concepts.mastery`, `teach_attempts`, the EMA at `src/core/store/hooks.ts:401`).

- **Injected `learnerState`:** for each prereq, the learner's `mastery` and any open teach-back `gaps` (`src/core/generation/teachback.ts`).
- **Authoring effect:** prereq mastered → a one-line callback; prereq weak (low mastery / open gap) → a built-in refresher before building on it. The prompt adapts depth, not just references.
- **Re-tailor policy:** a lesson is cached once generated. When a prereq's mastery crosses a **material threshold** (e.g. mastery delta ≥ 0.2 or a gap closes), dependent generated lessons are marked **stale** (a flag on the lesson, surfaced as an unobtrusive "your understanding changed — refresh this?" affordance, or auto-revised via B6). We do **not** regenerate on every minor mastery tick. Re-tailoring routes through the self-healing revise path (B6) so it is versioned and transparent.

Caveat (honest): adaptivity makes a lesson's content depend on learner state, complicating caching. The threshold + explicit-refresh affordance keeps it bounded and user-controlled rather than thrashing.

## B6. Self-healing coherence (full)

Lessons become **living documents**: when their context shifts, a background editor reconciles them. New `src/core/generation/coherence.ts` + a module-level job registry mirroring `lessonStreams.ts` / `widgetJobs.ts` (dedupe, abort, status via `useSyncExternalStore`, watchdog, survives navigation).

- **Triggers:** an ancestor/prereq lesson is regenerated; the canon changes materially; a prereq's mastery crosses the B5 threshold; or an explicit "tidy this branch" action.
- **Cheap drift-check first (the `coherence` task, fast model):** compare an affected lesson's `digest` against the new canon/parent digests — does it actually contradict notation, reference something now changed, or re-motivate something now upstream? Only lessons that **truly drifted** proceed; most checks are no-ops. This bounds cost (you check digests, not full prose) and avoids needless rewrites.
- **Revise (the `revise` task, strong model):** rewrite only the drifted lesson, given the old lesson + the changed context + the specific drift. Re-emits a fresh digest (B2) so the memory stays consistent.
- **Versioning + trust:** add `version`, `revisedAt`, `revisedReason`, and `prevSnapshot` (the prior `{subtitle, blocks}`, nullable) to `lessons`. Surface an unobtrusive **"auto-revised" badge** with a one-click **diff/revert** (restore `prevSnapshot`). Silently rewriting content a learner is studying would erode trust — revisions are always visible and reversible. One level of undo (latest `prevSnapshot`) in v1, not full history.

DIRECTIVE: a self-heal never runs while the target lesson is streaming (`isLessonStreaming` guard, already exported from `lessonStreams.ts`); a revise upserts like a normal generation so the existing publish/invalidate path applies.

## B7. SemanticIndex — capability-gated cross-tree retrieval

The canon prereq graph (B1) gives cross-tree "builds on" without embeddings; the SemanticIndex makes it **robust at scale**, surfacing related lessons the model didn't think to wire up.

- **Gated on the `embeddings` capability (Part A).** Present and excellent when an embeddings provider is configured (cloud key, or **local Ollama**); fully dormant otherwise — cohesion still works via canon prereqs (A5).
- **Mechanism:** embed each lesson's `digest` (via `getEmbedderFor`) into `sqlite-vec` (the reserved SemanticIndex from `2026-05-27-ascent-design.md`). At generation time, retrieve the top-k most related **already-generated** lessons across the whole tree and add their digests to `prereqDigests`, so a lesson can reference what it genuinely relates to, not just its tree neighbors.
- **Storage:** a `lesson_embeddings` virtual table (sqlite-vec), keyed by conceptId; written when a digest is produced/updated (B2/B6). Lazy: only populated if an embeddings provider is enabled.

## B8. Making it visible (light — the chosen UI)

Per the user: the prose is primary; this is a thin, additive surface.

- **"Previously" + "Up next" bands** in `LessonPane`, driven by digests + canon: a top band recapping the referrer/parent (clickable source chip → navigate) and a bottom band of forward-promise chips (`suggestedForks` framed as "where this leads" + `suggestedLessons` links). Both are data we already compute; the band just renders it.
- **Builds-on / leads-to edges** feed the planned ⌘G graph view — reuse `concept_links` (`src/core/store/schema.ts:65`); the canon prereq graph and SemanticIndex relations populate typed edges (a `relation` discriminator: `link | builds-on | leads-to`).
- **"Auto-revised" badge** (B6) on revised lessons, with diff/revert.
- **No arc rail** (option C from mockups) in v1.

---

## Data model additions

- **`course_canon`** table + `canonRepo`, keyed `topicId`: `spine` (json), `notation` (json), `motifs` (json), `voice` (json), `prereqs` (json: `Record<conceptId, conceptId[]>`), `version` (int), `updatedAt` (int).
- **`lessons` +**: `digest` (json, nullable until B2 runs), `version` (int, default 1), `revisedAt` (int, nullable), `revisedReason` (text, nullable), `prevSnapshot` (json, nullable), `stale` (boolean, default false — the B5 re-tailor flag).
- **`concept_links` +**: optional `relation` enum (`link | builds-on | leads-to`, default `link`) so the graph can distinguish continuity edges from generic links (back-compatible: existing rows = `link`).
- **`lesson_embeddings`** (sqlite-vec virtual table) — only when an embeddings provider is enabled (B7).
- **Provider config** in settings (localStorage); **provider secrets** in Keychain via `secretStore`, keyed `provider:<id>` (A3).
- Migrations via the existing `db_execute` path (`src/core/store/migrate.ts`).

## Per-task model routing extensions (`src/core/ai/tasks.ts`)

New task ids, continuing the migration the `widget` task started, each declaring `requiredCapability` and a sensible default tier:

- **`canon`** — seeds + maintains the canon; strong model (it grounds the whole topic). `textGeneration`.
- **`digest`** — per-lesson self-digest; fast model (Haiku-class). `textGeneration`.
- **`coherence`** — the drift-check; fast model. `textGeneration`.
- **`revise`** — the self-heal rewrite; strong model. `textGeneration`.
- **`embed`** — digest embeddings; `embeddings` capability (resolves via `getEmbedderFor`).

DIRECTIVE: every new generator resolves through `getModelFor`/`getEmbedderFor`, never a hardcoded model — the rule the widget path established and the visual-learning spec reaffirmed.

## Spikes (riskiest-first — lock details only after these)

Per the project's "verify integrations with runnable spikes before locking" rule:

1. **Self-healing drift-check precision (the trust risk).** Does a fast model reliably distinguish *real* drift (broken reference, contradicted notation) from noise, so it neither rewrites good lessons nor misses real breaks? Run on hand-constructed drifted/clean pairs. If precision is poor, fall back to **detect-and-flag-only** (the option considered in brainstorming) rather than auto-rewrite. **Gates B6's auto-revise.**
2. **Canon authoring quality from the outline.** Have the `canon` model produce spine + notation + prereq graph from a real outline (the ML demo topic). Is the prereq graph good enough to ground "builds on" without embeddings? Decides how much B7 matters for v1 quality vs robustness.
3. **Cohesion actually lands (the core premise).** A/B several lessons generated with vs without the continuity context + handoff prompt (B3/B4); does the prose genuinely build on prior lessons (precise refs, no re-motivation) without hallucinating references? This validates the whole engine; if the model ignores or misuses the context, tune the prompt before building B5/B6.
4. **Embeddings via Ollama + sqlite-vec.** Local embed → store → top-k retrieve → relevance sane? Confirms the capability-gated path end-to-end on a keyless local provider.
5. **Multi-provider text + structured output** (= Part A spike A7.1): a non-Anthropic provider through `getModelFor` with the `jsonTool`/structured-output path intact.

## Build order (by dependency/risk, not gated rollout)

Development cost ≈ 0, so no phased gating — but dependency order matters, and the felt win should come first:

- **The felt win first (works on today's single provider):** Course Canon (B1) + Lesson Digests (B2) + continuity context (B3) + handoff authoring (B4) + the "Previously / Up next" bands (B8). **Run spike #3 here** — this is the thesis. Everything below is amplification.
- **Learner-adaptivity (B5):** layers onto the context once digests/canon exist; reuses mastery/teach-back already in the store.
- **Self-healing (B6):** the largest surface and the trust risk; **run spike #1 before committing to auto-revise** — degrade to flag-only if precision is weak. Needs the versioning columns.
- **AI Provider & Capability Registry (Part A):** independently valuable (Ollama, multi-provider for *everything*); a parallel track. Only **B7 hard-depends on it**. Spikes A7.1/A7.2 (= #5/#4 inputs).
- **SemanticIndex (B7):** after the registry + spike #4; capability-gated, so it ships dark and lights up when an embeddings provider exists.

## Honest complexity & caveats

- **Self-healing is the biggest new surface and the trust risk.** Mutable, auto-rewritten lessons need the visible badge + revert and a drift-check that doesn't false-fire (spike #1). The flag-only fallback is a real, acceptable v1 if precision disappoints.
- **Cohesion is ultimately a prompting outcome.** Spikes #2/#3 test whether the model *uses* the canon/digests well and doesn't hallucinate references. The memory layer is necessary but not sufficient; the prompt (B4) is where it's won or lost.
- **Living-canon concurrency.** Write-backs happen after lesson upsert, last-writer-wins on one row — simple, but a flurry of parallel generations could clobber a merge; the merge must be field-level (append notation/motifs), not whole-row replace.
- **Adaptivity complicates caching.** Lessons become learner-dependent; bounded by the material-threshold + explicit-refresh affordance, not per-tick regeneration.
- **Embeddings in a local-first app** is solved by capability gating, but **retrieval relevance is a quality wildcard** (spike #4); canon prereqs are the always-on floor.
- **The digest call adds one cheap call per lesson** and sits on the dependency path for downstream cohesion — acceptable given cost ≈ 0, and off the render critical path.

## Out of scope (v1)

- Shared/cross-learner canon; any multi-user or sync (still behind the future paid-tier repository seam).
- OAuth provider auth — API-key-in-Keychain + local (Ollama) only, matching the media spec.
- Full lesson version history/timeline UI — one-step revert (`prevSnapshot`) only.
- Re-tailoring on every minor mastery change — only material thresholds.
- A new lens for continuity; the bands live in the lesson body, and relations feed the existing planned ⌘G graph.
- Generative-image / non-text capabilities beyond `embeddings` (the capability model supports them; not implemented here).
