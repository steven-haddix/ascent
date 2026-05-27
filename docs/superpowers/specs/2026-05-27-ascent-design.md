# Ascent — Design Spec

**Date:** 2026-05-27
**Status:** Approved in principle (brainstorming); pending written-spec review → implementation plan.
**Scope of this doc:** the v1 vertical slice and the durable architecture it sits on.

---

## 1. What Ascent is

Ascent is a **tool-for-thought for learning** — an AI-first desktop app where you don't consume a fixed curriculum, you **grow a knowledge tree by discovery** and **cement it with a Feynman loop**. It is *subject-agnostic*: today it ships with Machine Learning as the demo topic, but the engine knows nothing about ML — it works for history, biology, music theory, anything.

Three mechanics carry the product:

1. **The tree is the product.** Every concept is a node with a `status` (queued → current → visited → complete) and a `mastery` score. Learning = expanding and deepening your own tree.
2. **Forking is the core gesture.** Any *term* inside a lesson is forkable (⌘-click forks now, ⌥-click queues it); the AI also suggests branches. Curiosity becomes structure.
3. **Teach-back is the retention engine.** Explain a concept in your own words → the AI grades it on a rubric (clarity / accuracy / completeness / mental model) → your words are annotated (strong / vague / *gap*) → **gaps auto-fork as remedial branches** and re-highlight in the original reading.

It is positioned as a **dense, power-user, IDE-feeling** tool — not consumer EdTech.

### Provenance
The visual design and interaction model are taken from a high-fidelity HTML mock ("Knowledge Base — learn anything as a tree"). The mock's three-pane shell, warm-paper design system, tree sidebar, forkable terms, branch-grounded chat, Teach Mode, ⌘K palette, and ⌘G graph are adopted. The mock's ML-specific content and its prototype harness (single-file Babel bundler, `window.claude.complete`, the Tweaks `postMessage` protocol) are *not* — see §13.

---

## 2. Principles

- **AI-first & dynamic** — lessons, quizzes, suggestions, and grading are generated, never shipped as fixtures.
- **Subject-agnostic core** — zero ML (or any domain) knowledge in the engine. Domain specifics live in *generated content* and *opt-in lenses*.
- **Local-first** — all data on the user's machine; the app is fully usable with no account.
- **No auth by default** — first-run asks only for an API key.
- **BYO key** — the user supplies their own model API key, stored in the OS keychain.
- **Open-source friendly** — approachable stack, no proprietary lock-in, signed auto-updates from public releases.
- **Services abstracted for a sync-ready future** — storage, AI, and secrets sit behind interfaces so a paid **sync** tier and **accounts** can be added later as swaps, not rewrites.
- **Buy, don't build** — lean on maintained libraries for everything that isn't Ascent's unique value (the learning loop). See §4.

---

## 3. Goals & non-goals (v1 vertical slice)

**v1 proves the magic end-to-end for one real topic, with a subject-agnostic engine.**

**In scope (v1):**
- Tauri 2 desktop shell (macOS first), signed auto-update.
- First-run API-key capture → macOS Keychain.
- `AIService` over the Vercel AI SDK (Anthropic), provider-abstracted.
- `GenerationService`: generate a topic **outline up front**; generate each **lesson body on first visit** (streamed).
- `store/` (SQLite + Drizzle via a Rust `rusqlite` module) + TanStack Query reactive binding; Markdown/JSON export.
- Three-pane UI: tree sidebar · lesson pane (forkable terms + popover) · preview pane.
- Branch-grounded **chat** + quick prompts; tutor modes (Mentor / Socratic / Encyclopedic).
- **Teach-back** full loop: compose → grade (structured) → annotated result → auto-forked remedial branches → mastery update → re-highlighted gap terms.
- **Lenses:** Notes, Quiz, Chat (core, subject-agnostic) + **Code** (first opt-in module: Shiki highlighting **and** Pyodide execution, lazy-loaded).
- ⌘K command palette + ⌘G graph view (rendered from the tree).
- Settings (replaces the mock's Tweaks panel): theme (cream/paper/dark), accent, tutor mode, provider/model, API key.
- Design system: Tailwind v4 + HeroUI v3 themed to the mock's palette + fonts.
- ML as the seed/demo topic.

**Out of scope (deferred to v2+):**
- `SemanticIndex` — embeddings, semantic ⌘K, "related concepts," smart cross-links (seam designed-in; see §10).
- Generic AI-driven **Viz** lens (timeline/map/plot/structure). Code is the only opt-in module in v1.
- Multi-provider live switching beyond Anthropic; Ollama/local models (abstraction in place; second provider not wired).
- **Sync** + **accounts** (the paid tier). Repository seam + export make this additive later.
- Spaced-repetition scheduling of mastery.
- Windows/Linux packaging, web/mobile targets (architecture stays portable).

---

## 4. Verified tech stack (mid-2026)

All versions confirmed live during research on 2026-05-27.

| Layer | Choice | Version | Notes / source |
|---|---|---|---|
| Desktop shell | **Tauri 2** | 2.11.2 | `create-tauri-app` → React/TS/Vite. Capabilities JSON required per plugin. |
| Language/build | **TypeScript + Vite + React 19** | — | Matches the mock; best Tauri DX. |
| AI | **Vercel AI SDK** `ai` + `@ai-sdk/anthropic` | 6.0.191 / 3.0.80 | Runs in webview; structured output + streaming + agent loops + embeddings. |
| Schemas | **Zod 4** | ^4.4.x | AI SDK v6 supports Zod 4 natively. |
| HTTP transport | **@tauri-apps/plugin-http** | 2.5.9 | Rust/reqwest fetch → no CORS. Streaming TBD (Phase-0 spike, §16). |
| Secrets | **`keyring` crate (Rust)** | 3.6.x | macOS Keychain via a Tauri command. *Not* Stronghold (deprecated pre-v3). |
| DB engine | **SQLite via `rusqlite` (Rust module)** | — | `sqlite-vec`-ready for future Compass; behind Drizzle's `sqlite-proxy`. |
| ORM | **Drizzle ORM** (`sqlite-proxy`) | latest | Type-safe queries + `drizzle-kit` migrations (applied via the Rust module). |
| Reactivity | **TanStack Query** | v5 | Over repository methods. (TanStack DB deferred — §10.) |
| UI primitives | **HeroUI v3** | 3.1.x | React 19-native, **Tailwind v4** (CSS-first, no plugin), CSS-var theming, `--radius:0`. |
| Tree sidebar | **react-arborist** | 3.8.x | Virtualized, keyboard, drag-drop. |
| Graph view | **@xyflow/react** (React Flow) | 12.10.x | MIT; custom React nodes. |
| Command palette | **cmdk** *or* React Aria | — | cmdk has a React-19 peer caveat (§16); React Aria already ships via HeroUI. |
| Code highlight | **Shiki** (+ `react-shiki`) | 4.1.x | Bundled offline (`shiki/core` + JS engine); replaces the mock's hand-rolled tokenizer. |
| Streaming markdown | **streamdown** | 2.5.x | For chat. `rehype-harden` (XSS-safe). Lesson bodies use typed blocks, not markdown. |
| Code execution | **Pyodide** | 0.29.x | Lazy-loaded, single-threaded (no COOP/COEP), `wasm-unsafe-eval` in CSP. |
| Auto-update | **tauri-plugin-updater** | 2.10.x | Signed bundles from GitHub Releases. |

### Buy-don't-build summary
The AI SDK replaces an entire hand-built provider/streaming/structured-output layer; `keyring` replaces Keychain FFI; Drizzle replaces a query layer; HeroUI replaces a component library; react-arborist / @xyflow/react / cmdk / Shiki / streamdown / Pyodide each replace a bespoke widget or subsystem. **What we build is the learning loop**, not infrastructure.

---

## 5. Architecture

```
UI   React 19 · Vite · Tailwind v4 · HeroUI v3 (themed → cream/paper/dark + accent, --radius:0)
     react-arborist (tree) · @xyflow/react (graph) · cmdk/React-Aria (⌘K) · Shiki (code) · streamdown (chat)
       │  binds via TanStack Query to store repositories (UI never touches the DB directly)
       ▼
CORE  (TypeScript · zero React · zero domain knowledge)
   AIService          wraps AI SDK v6 (@ai-sdk/anthropic) · getModel(provider, model) · injected fetch
   GenerationService  outlineTopic() → tree skeleton ;  generateLesson() → typed lesson blocks (streamed)
   TutorService       chat() (streamText) ;  gradeTeachBack() → structured JSON (generateObject)
   store/             repositories (Topic/Concept/Lesson/Note/Progress/Quiz/TeachAttempt/Chat)
                      Drizzle queries + TanStack Query hooks · MD/JSON export · sync-ready seam
   LensRegistry       Notes/Quiz/Chat (core) + Code (module) ; Viz (v2)
   SecretStore        getApiKey()/setApiKey()/clear()  (calls Rust)
   SemanticIndex      (v2) embeddings → related concepts, cross-links, semantic ⌘K
       ▼ invoke / channel
SHELL  Tauri 2.11 (Rust)
   • secrets module  → keyring crate → macOS Keychain
   • db module       → rusqlite (sqlite-vec-ready) ← Drizzle sqlite-proxy run_sql command + migrations
   • ai transport    → reqwest: injects key, calls api.anthropic.com (no CORS; streams via Tauri Channel)
   • updater         → signed GitHub releases
```

**Boundary rule:** the UI depends only on `store/` repository methods and the core service interfaces — never on Drizzle internals, the AI SDK, or Tauri commands directly. This single discipline is what makes sync, accounts, and provider swaps additive later.

### Core service responsibilities
- **AIService** — the only place that touches the AI SDK and model selection. Exposes `streamText`, `generateObject`, (v2) `embed`. Provider/model chosen via a `getModel()` factory; the request `fetch` is injected so all CORS/key handling lives in one spot.
- **GenerationService** — orchestrates prompts. `outlineTopic(title)` returns a tree skeleton (concept titles + one-line rationale + suggested lenses) via `generateObject`. `generateLesson(concept, context)` streams typed blocks (+ terms, suggested branches, declared lenses, quiz seeds). Context = the concept's breadcrumb path + topic + sibling/parent titles (this replaces the mock's baked-in "studying transformer encoder blocks").
- **TutorService** — `chat(concept, history, mode)` streams a branch-grounded reply; `gradeTeachBack(concept, text, audience)` returns a structured grade object. Tutor modes are system-prompt presets.
- **store/** — repositories with typed CRUD; reactive reads via TanStack Query; export to Markdown/JSON.
- **LensRegistry** — registers lenses; the UI asks it which lenses a given lesson declares and renders only those.
- **SecretStore** — thin wrapper over the Rust keyring commands.

---

## 6. Data model

Subject-agnostic. ML is just rows.

- **Topic** — a tree root = one subject. `{ id, title, rootConceptId, createdAt }`
- **Concept** (node) — `{ id, topicId, parentId, title, status: queued|current|visited|complete, mastery: 0..1, order, state: outline|generating|ready, remedial: bool, createdAt }`
- **Lesson** — `{ conceptId, title, subtitle, blocks: Block[], suggestedBranches: {title, reason}[], lenses: LensId[], model, generatedAt }`
- **Block** (typed, *not* HTML) — discriminated union:
  - `paragraph` → `content: (string | Term)[]`
  - `callout` → `{ label, text }`
  - `media` → `{ source, locator, label, sublabel, note }` (source-agnostic)
  - `section` → `{ label, hint }`
- **Term** — `{ term, gloss, branchHint?: bool }` (inline, forkable; structured data, *not* parsed from prose)
- **Note** — `{ id, conceptId, text, createdAt }`
- **QuizItem** — `{ id, conceptId, question, choices[], answerIndex, explanation }`
- **TeachAttempt** — `{ id, conceptId, audience, text, rubric{clarity,accuracy,completeness,model}, verdict, annotations[], gaps[], masteryDelta, createdAt }`
- **ChatTurn** — `{ id, conceptId, role: user|ai, text, attachments?[] }`
- **MediaRef** — `{ id, conceptId, kind, source, locator, chapters?[] }` (generalizes the mock's YouTube-only videos)

**Load-bearing field:** `Lesson.lenses[]`. The lesson *declares* which right-pane modules apply — this is what replaces the mock's hardcoded tab bar and makes "code is opt-in" literally true. A PyTorch concept gets `["notes","quiz","chat","code"]`; a French-Revolution concept never gets `code`.

Typed blocks (not HTML/markdown) keep lessons renderable, forkable, and domain-neutral, and let us **stream block-by-block** while preserving forkable terms as data.

**Mastery (v1):** a concept's `mastery` is updated by teach-back `masteryDelta` and quiz performance (a simple weighted update). Spaced-repetition scheduling is deferred (§18).

---

## 7. The lens / opt-in module system (dynamic vs hardcoded — solved)

A **Lens** is a capability that both contributes to generation and renders in the right pane:

```ts
interface Lens {
  id: string;                              // "notes" | "quiz" | "chat" | "code" | "viz"(v2)
  label: string; icon: string;
  appliesTo(lesson: Lesson): boolean;      // usually: lesson.lenses.includes(id)
  generationContribution?(ctx): PromptPart // optional: what to also ask the model to produce
  Renderer: React.FC<LensProps>;
}
```

- **Core lenses** (always registered, subject-agnostic): **Notes**, **Quiz**, **Chat**.
- **Opt-in modules** (self-contained folders): **Code** (v1); Viz and others later.
- During generation, the model answers *"which lenses are relevant to this concept?"* → fills `lesson.lenses`. The UI renders only those tabs.

### Code module (v1)
- **Highlighting:** Shiki (`shiki/core` + JS regex engine, bundled offline) via `react-shiki`; supports line highlighting + inline annotations. Deletes the mock's hand-rolled `nn/torch` tokenizer.
- **Execution:** **Pyodide**, lazy-loaded on the first "Run" (4–5 s cold start with a progress UI; warm thereafter). Single-threaded → no COOP/COEP/SharedArrayBuffer; add `'wasm-unsafe-eval'` to the Tauri CSP. Sandboxed (no filesystem/network unless explicitly bridged — we don't). Python only in v1; multi-language is a future WASM-runtime direction.

---

## 8. Generation pipeline ("AI agents build sections")

Each step = a prompt template + an `AIService` call, streamed, with the concept's **path + topic + neighbors** as context.

1. **New topic** (`outlineTopic`) → tree skeleton (titles + one-line rationale + suggested lenses) via `generateObject`. Persist concepts as `outline`. *Fast — this is what you navigate.*
2. **Visit concept** → if not `ready`, `generateLesson` streams typed blocks (+ terms, suggested branches, declared lenses, quiz seeds) via `streamObject`/`Output.array` `elementStream` (each block arrives complete and schema-validated). Persist `ready`.
3. **Fork term/branch** → insert child concept (`queued`) under the current node; generates on first visit.
4. **Teach-back** (`gradeTeachBack`) → structured JSON (rubric / verdict / gaps / annotations) → bump mastery, auto-fork remedial concepts, re-highlight gap terms. If grading fails, the user sees a clear retry — **never a fabricated grade** (a labeled fixture exists for dev/latency testing only, never surfaced as a real result).
5. **Chat** (`chat`) → branch-grounded reply via `streamText`; tutor mode = system-prompt preset.

Agentic orchestration uses the AI SDK's tools + `stopWhen` (or `ToolLoopAgent`) where open-ended; for the fixed outline→section pipeline, explicit `generateObject` + per-section `streamObject` is preferred (more deterministic).

---

## 9. AI integration & security

- **SDK:** Vercel AI SDK v6 with `@ai-sdk/anthropic`. Structured output uses Anthropic's native JSON-schema (constrained decoding) — grades and lesson blocks are reliable, not best-effort.
- **Streaming consumption:** call core functions directly (`streamText`, `streamObject`) and read the async stream into React state. **Not** `useChat`/`experimental_useObject` (those assume an HTTP endpoint — wrong for a no-backend desktop app).
- **Model IDs (mid-2026):** `claude-opus-4-7` (flagship), `claude-sonnet-4-6` (default), `claude-haiku-4-5-20251001` (cheap/fast). Default to Sonnet; allow override in Settings.
- **Provider abstraction:** one `getModel(providerId, modelId)` factory. Adding OpenAI (`@ai-sdk/openai`) or Ollama (`ai-sdk-ollama`) later is a near-drop-in; call sites stay identical. (Embeddings: Anthropic has none → use OpenAI or local Ollama for the future `SemanticIndex`.)
- **Transport & key safety:** requests route through Rust (reqwest), not the webview's native fetch — this eliminates CORS and means we do **not** need `anthropic-dangerous-direct-browser-access`. The API key is read from the Keychain at call time and injected into the request **in Rust**.
  - **Plan (gated by the §16 streaming spike):** the likely implementation is a **Rust streaming command** that reads the key from the Keychain, builds the request, and streams SSE chunks back over a **Tauri Channel**, surfaced to the AI SDK via an injected `fetch` shim — which both enables live token streaming and keeps the key **entirely out of the JS heap/devtools**. If the spike shows `@tauri-apps/plugin-http`'s fetch already streams the body incrementally, we take that simpler path (key read from the Keychain at call time). The spike decides; either way requests run in Rust (no CORS).

---

## 10. Persistence & reactivity

- **Source of truth:** SQLite, accessed through a **small Rust `db` module built on `rusqlite`**. Drizzle ORM runs in TS via the `sqlite-proxy` driver and calls a Rust `run_sql` command for execution; Rust owns JSON serialization (this removes the documented empty-result `get()` workaround of the `tauri-plugin-sql` path). Choosing `rusqlite` also enables runtime extension loading, so **`sqlite-vec` drops in for the future `SemanticIndex` with no parallel DB layer**.
- **Migrations:** `drizzle-kit generate` produces SQL locally; the SQL is inlined at build time (Vite `import.meta.glob('...*.sql', { query: '?raw' })`) and applied by a startup migration runner through the Rust module, tracked in `__drizzle_migrations`. Append-only discipline once shipped.
- **Reactivity:** **TanStack Query** over repository methods (query keys per entity; invalidate on mutation). Good caching + loading/error states with zero exotic dependencies.
- **Repository seam:** all data access behind `*Repository` interfaces. The UI never imports Drizzle. This seam is what lets us later (a) swap the reactive layer to TanStack DB once it's ≥1.0, or (b) introduce a sync engine, without touching UI.
- **Portability:** Markdown/JSON export of a topic ("own your data").
- **Sync (deferred, paid):** chosen at that time — **PowerSync** is the front-runner (purpose-built embedded-SQLite sync with a native Tauri SDK), with libsql/Turso as the alternative (native vector + sync). Not built in v1; the seam keeps it additive.
- **TanStack DB (deferred):** genuinely good and newly local-first-capable, but pre-1.0 (0.1.x) and it wants to own its own SQLite tables rather than ride on the Drizzle schema. Re-evaluate at its 1.0; adopt through the repository seam if/when it (or a sync engine) is warranted.

---

## 11. Secrets & no-auth

- **No accounts in v1.** First run shows a one-screen setup: paste an API key → stored in the **macOS Keychain** via the `keyring` crate (service `"ascent"`, account e.g. `"anthropic-api-key"`). Commands: `set_api_key`, `get_api_key`, `delete_api_key`.
- The frontend never persists the key in JS state; the hardened transport (§9) keeps it Rust-only.
- Settings lets the user replace/clear the key and pick provider/model.
- **Future accounts/sync** layer on top of `SecretStore` + `store/` without disturbing the no-auth default.

---

## 12. Design system & theming

- **Tailwind v4 + HeroUI v3** (CSS-first: `@import "@heroui/styles"`, no Tailwind plugin).
- **Map the mock's existing CSS variables onto HeroUI/Tailwind tokens** — the mock is already fully variable-driven, so this is near 1:1:
  - Backgrounds `--bg / --surface / --surface-2`; ink `--ink / --ink-2/3/4`; rules `--rule / --rule-strong`; **single accent** `--accent` (+ soft/tint/highlight); shadows.
  - Themes: **cream** (default), **paper**, **dark** — as `[data-theme]` blocks.
  - Fonts: **Geist** (UI sans), **Source Serif 4** (lesson body), **Geist Mono** (code/numerics) — bundled, not CDN.
  - `--radius: 0` (with hairline borders) to get the dense "paper/IDE" feel rather than HeroUI's default rounded look.
- **Use HeroUI for primitives** (buttons, inputs, modals, dropdowns, tooltips, popovers). **Keep bespoke components custom** (tree rows, term popover, attention/heatmap-style viz, Teach-back stages, code/diagram panes) — all sharing the same theme tokens.

---

## 13. From the mock: adopt / generalize / drop

| Mock element | Disposition |
|---|---|
| 3-pane shell, paper design system, type system, theming | **Adopt** (port to Tailwind+HeroUI tokens) |
| Tree sidebar (mastery dots, status, rails, hover-fork) | **Adopt** (react-arborist) |
| Forkable terms + popover, branch chat + quick prompts | **Adopt** |
| Teach Mode (Feynman) full loop | **Adopt** (crown jewel; already general) |
| ⌘K palette, ⌘G graph (with cross-links) | **Adopt** (cmdk/React-Aria, @xyflow/react) |
| Notes auto-linked to branches; tutor modes; suggested branches | **Adopt** |
| Preview-pane "tabs" | **Generalize** → declared **lenses** |
| "Attention" heatmap tab | **Generalize** → pluggable Viz lens (v2); it's an ML-only visualizer today |
| Quiz content + hardcoded feedback | **Generalize** → generated per concept |
| Videos (YouTube/Karpathy) | **Generalize** → source-agnostic MediaRef (keep chapter-jump idea) |
| System prompts ("…transformer encoder blocks") | **Generalize** → templated from concept context |
| Code tab (Python tokenizer, fake "Run") | **Opt-in module** → Shiki + real Pyodide execution |
| `SEED_TREE`/`LESSON`/`CODE_SAMPLE`/`QUIZ` fixtures | **Drop** → generated + persisted |
| Babel single-file bundler; Tweaks `postMessage`/EDITMODE; `window.claude.complete` global; "Knowledge Base/session #142/CH" branding | **Drop** → real build, Settings, `AIService`, Ascent branding |

---

## 14. Error handling

- **Missing/invalid API key** → setup screen / inline Settings prompt; never a silent failure.
- **Generation failure (outline/lesson)** → toast + retry on the affected node; node stays `outline`/`queued`, not corrupt.
- **Streaming interruption** → keep blocks already received; offer "continue".
- **Teach-back grading failure** → show a clear error + retry; the attempt is saved as ungraded. **Never present a fabricated grade.**
- **Chat/tutor offline** → "(tutor offline — try again)" bubble (as the mock does), no crash.
- **DB/migration error at startup** → blocking error screen with the failing migration; never run the app on a half-migrated DB.
- **Pyodide load failure** → Code lens degrades to highlight-only with a clear message.

---

## 15. Testing strategy

- **Core services (unit):** `GenerationService`, `TutorService`, `LensRegistry`, repositories — tested against a **mock `AIService`** (deterministic fixtures) and an in-memory/temp SQLite. No network in unit tests.
- **Schema/contract tests:** Zod schemas for outline, lesson blocks, and the teach-back grade — round-trip validation so prompt/parse drift is caught.
- **Store/integration:** migrations apply cleanly on a fresh DB; repository CRUD + export round-trips.
- **Component tests:** tree, lesson pane (forkable terms + gap highlighting), Teach-back stages, lens switching, Code lens (highlight; execution mocked).
- **Light e2e (Tauri):** first-run key capture → new topic → outline → visit/generate → fork → teach-back → remedial branch appears.
- **Spikes are gated by their own acceptance checks** (§16).

---

## 16. Risks & Phase-0 spikes

Two spikes run **before the spec is locked for build**:

1. **rusqlite + Drizzle (`sqlite-proxy`) integration.** Acceptance: typed Drizzle queries (incl. a relational `get`) execute through the Rust `run_sql` command with correct results; `drizzle-kit`-generated migrations apply at startup; a trivial `sqlite-vec` load succeeds (proving the future seam). Fallback if it underperforms: `tauri-plugin-sql` + the documented runner (accepting the `get()` shim and a separate future vector layer).
2. **AI streaming transport.** Acceptance: tokens stream incrementally into the UI. Determine whether `@tauri-apps/plugin-http` streams the response body (simpler) or whether we need the Rust streaming command + Tauri Channel (which also makes the key Rust-only). Lock the §9 transport decision based on the result.

Lower-risk watch-items:
- **cmdk + React 19** peer-dep caveat → use the maintained/vendored fork *or* build the palette on React Aria (already in HeroUI). Avoid `--legacy-peer-deps`.
- **Pyodide cold start** (4–5 s) → lazy-load + progress UI; cache after first load.
- **HeroUI dense theming** → confirm `--radius:0` + spacing overrides reproduce the paper/IDE density before building many screens.

---

## 17. Build order (milestones)

- **M0 — Spikes (§16).** De-risk data engine + AI streaming. Exit: both acceptance checks pass; transport + DB decisions locked.
- **M1 — Foundation.** Tauri shell + capabilities; `SecretStore` (keyring) + first-run key capture; `store/` schema + migrations + repositories; theming (Tailwind v4 + HeroUI mapped to the mock's vars) + app shell (3-pane + topbar).
- **M2 — AI + generation.** `AIService` (injected fetch) + `getModel()`; `GenerationService.outlineTopic`; tree sidebar (react-arborist) renders a generated outline; new-topic / home flow.
- **M3 — Lesson + discovery.** `generateLesson` streaming typed blocks into the lesson pane; forkable terms + popover; suggested branches; fork → queued child → generate on visit; breadcrumb.
- **M4 — Chat + lenses.** `TutorService.chat` + quick prompts + tutor modes; `LensRegistry`; Notes/Quiz/Chat core lenses; preview pane.
- **M5 — Teach-back.** Full Feynman loop (compose → grade → annotated result → remedial branches → mastery update → re-highlighted gaps).
- **M6 — Code module.** Shiki highlighting; Pyodide execution (lazy); lens declared by generation.
- **M7 — Palette/graph/polish.** ⌘K palette, ⌘G graph (from tree), Settings, export, signed updater; ML demo topic seeded; pass on motion/empty/error states.

---

## 18. Deferred (v2+)
`SemanticIndex` (embeddings via `sqlite-vec`) → semantic ⌘K, related concepts, smart cross-links · generic **Viz** lens · multi-provider/Ollama live switching · **sync + accounts** (paid; PowerSync/Turso) · spaced-repetition mastery scheduling · Windows/Linux/web/mobile.

---

## 19. Open questions
- macOS-only for v1, or keep Windows/Linux packaging warm from the start? (Stack is portable; only the keychain/updater specifics differ.)
- Pyodide package set to pre-bundle (core only vs core+numpy) — decide at M6 based on demo content.
