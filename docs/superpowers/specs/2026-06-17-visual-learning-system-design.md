# Visual Learning System — Design

**Date:** 2026-06-17
**Status:** Approved direction (whole-vision design; build order by dependency/risk, not phased gating).
Supersedes nothing; extends the M8 visual blocks and the
[Interactive Widgets design](2026-06-09-interactive-widgets-design.md).

## Goal

Make Ascent *materially less text-heavy*, especially for non-coding subjects (history, arts,
language, law, biology, geography), without abandoning the local-first / BYO-Anthropic / no
raster image-gen constraints that made the current visual strategy work.

Two problems are deliberately separated, because they need different solutions:

- **Coverage** — do visuals show up *at all* in a humanities lesson. Today they mostly don't:
  every primitive is STEM-shaped (`chart` = quantitative series, `math` = LaTeX, `code` =
  runnable code, `diagram` = process/state). A lesson on the causes of WWI has no series, no
  equation, no code, so the model falls back to prose. **This is the real pain**, and adding
  raw capability (d3) does not fix it.
- **Ceiling** — *can* we render richer things (maps, force-directed graphs, geographic data,
  bespoke interactions). This is what d3 addresses.

This design fixes coverage first-class (the Visual Planner + a humanities-native block
vocabulary) and raises the ceiling (modular d3 in two layers + a content-agnostic media
provider system), under one organizing abstraction so new visual types and new content sources
are plugins, not forks of the generator.

## 1. Organizing architecture

Visuals become a **pluggable capability** with four production paths, fed by a planning pass
and dispatched through a registry:

```
Lesson generation
      │  prose + visual intents
      ▼
Visual Planner ── consults ──► Visual Registry  (visual types as plugins)
      │  per-domain visual budget + completeness check
      ▼
 ┌──────────────┬──────────────┬──────────────────┬───────────────────┐
 │ Native blocks│ Data viz + d3│ Generative widgets│ Media providers   │
 │ model emits  │ app-layer d3 │ sandboxed d3 code │ real images (then │
 │ data         │ maps,graphs  │ (bespoke interact)│ video/embed/gen)  │
 └──────────────┴──────────────┴──────────────────┴───────────────────┘
   reliable        reliable        flexible            external/network
```

Two of the four paths render in the trusted app (reliable, deterministic); one is the existing
AI-coded sandbox (flexible, lower reliability); one reaches the network through Rust. The
Registry makes them uniform; the Planner makes coverage intentional.

> The architecture sketch shown during design labels the planning pass "Visual Director"; in
> code it is the **Visual Planner** (`planVisuals` → `VisualPlan`) — functional naming, like the
> existing `planner`. Same thing.

## 2. Visual Registry — the modular spine

The registry is **split into facets** so no single object spans core logic, AI authoring, React
rendering, and async jobs at once. A monolithic plugin would drag `BlockRenderer` — a `src/ui`
type ([LessonPane.tsx:50](../../../src/ui/LessonPane.tsx)) — into `src/core`, inverting the
core→UI-free invariant the codebase holds today (verified: `src/core` imports nothing from
`src/ui`). Each visual kind is described by up to four small definitions, each living where its
dependencies already live:

```ts
// src/core/visuals/catalog.ts — pure metadata, no UI/AI deps
interface VisualKindDefinition {
  id: VisualKind;                 // "timeline" | "figure" | "graph" | "spectrum" | "map" | "media" | "chart" | "diagram" | "widget"
  label: string;
  affinity: Domain[];             // subjects this serves well → drives the Planner's budget
  production: "inline" | "job";   // inline = emitted in the lesson stream; job = async fill
  requiresAltText: true;          // accessibility policy (§10)
}

// src/core/visuals/authoring.ts — what the generator needs
interface VisualPromptDefinition {
  kind: VisualKind;
  guidance: string;               // prompt fragment, assembled into the lesson prompt
  schema: ZodRawShape;            // fragment merged into LessonSchema for this kind (per-kind guards, §10)
}

// src/ui/blocks/registry.ts — what the renderer needs (UI layer)
interface VisualRendererDefinition {
  kind: VisualKind;
  isRenderable: (b: Block) => boolean;   // per-kind gate; replaces the monolith in LessonPane
  render: BlockRenderer;
}

// src/core/generation/visualJobs.ts — ONLY for production: "job" kinds (widget, media, figure)
interface VisualJobDefinition {
  kind: VisualKind;
  scan(partial: PartialLesson): Intent[];   // settled placeholders to kick off mid-stream
  start; resume; retry;                      // the widgetJobs lifecycle, generalized
}
```

`visualCatalog` + `visualAuthoring` (core) feed planning and generation; `visualRenderers` (ui)
feeds `renderBlock`; `visualJobs` (generation) drives async fills. A new kind registers in each
facet it needs — a `spectrum` needs catalog + authoring + renderer (no job); a `media` needs all
four. Plugin-like extensibility without one object understanding planning, schemas, React, jobs,
and accessibility simultaneously.

**Load-bearing payoff:** the lesson prompt's per-kind guidance is *assembled from
`visualAuthoring`* instead of a hand-maintained wall of text in `lesson.ts`, and `renderBlock`
([LessonPane.tsx:63](../../../src/ui/LessonPane.tsx)) dispatches through `visualRenderers`
instead of a `kind ===` ladder. Mirrors how `LensRegistry`, `AI_TASKS`, and the repo pattern
already factor the codebase.

`Domain` is a small closed set inferred per topic/concept (see §3): `science`, `math`,
`programming`, `history`, `biography`, `arts`, `music`, `language`, `law`, `business`,
`geography`, `general`. Inference is cheap and reused, not a per-lesson model call where the
topic already implies it.

DIRECTIVE: new visual kinds register **per facet** — catalog + authoring in `src/core`, renderer
in `src/ui`, job handler in `src/core/generation`. Keep `src/core` free of `src/ui` imports; the
renderer facet is that boundary. No per-kind `if (kind === …)` ladders in `lesson.ts` or
`LessonPane.tsx`; plain prose kinds (paragraph/section/callout) stay inline and are not plugins.

## 3. Visual Planner — the coverage fix

The single most important subsystem: it converts visuals from "occasionally emitted" to
"intentionally designed in." It is **not** a fragile separate placement model. It is two
concrete, cheap mechanisms:

### 3a. Domain-aware visual budget (prompt-time)

Before lesson generation, resolve the concept's `Domain` and ask the Registry which visual
kinds have affinity for it. The lesson prompt is then assembled with a *budget*, not just a
palette: e.g. a `history` lesson is told to include at least one `timeline` and at least one of
`map` / `figure` / `media` where the content supports it; a `biology` lesson leans
`figure` (labeled anatomy) + `media`; a `music` lesson leans `figure` (staff/structure). STEM
keeps today's calibration. The budget is guidance with teeth ("reach for these unless the
content genuinely resists it"), not a hard quota that forces decorative visuals.

### 3b. Completeness pass (post-stream, append-only)

After the lesson streams, a cheap check (`getModelFor("director")`) evaluates whether the
lesson's actual visual coverage fits its domain and budget. If a humanities lesson came back as
a wall of prose, the pass returns 1–N additional visual intents (kind + spec/query) that are
**appended** to the lesson as new blocks.

**Placement division of labor (load-bearing):** inline placement is 3a's job — the author emits
visuals *in situ* as it writes, next to the relevant prose. 3b is a pure **append-only** safety
net for what the author missed. It does **not** insert into the middle of `lesson.blocks`.

Why the constraint: mid-array insertion after the final `lessonRepo.upsert` would race
regeneration, in-flight widget/media jobs, and learner highlights, and would shift the positional
identity other code relies on (`widgetId`/`mediaId` slugs are stable, but block *positions* are
not addressable today). Appending after the final upsert touches none of that — a new
end-of-lesson `timeline` or `map` is still pedagogically useful (a visual recap), and the async
jobs it enqueues are the same §6/§7 machinery.

DIRECTIVE: in v1 the completeness pass may only **append** visual blocks after the lesson's final
upsert. Mid-lesson insertion is gated on first giving blocks **stable IDs** (a separate change);
until then, do not splice into `lesson.blocks` from a post-stream pass.

DIRECTIVE: the Planner's value is empirical. Ship spike #5 (§11) — measure visual-coverage
uplift on real non-STEM lessons with vs without the budget+check. If uplift is marginal, keep
3a (prompt budget) and drop 3b; do not carry an unproven second pass.

## 4. New declarative block vocabulary (reliable workhorses)

New `Block` kinds, each a Registry plugin, rendered natively in `src/ui/blocks/` — no sandbox,
no codegen, themeable, offline. The model emits *structured data*; the app renders
deterministically. These are added to the flat `Block` shape in
[types.ts](../../../src/core/types.ts) (optional fields, exactly how `widget` was added) and to
`LessonSchema`.

- **`timeline`** — events / eras on an axis; optional lanes. History, biography, evolution of an
  idea, narrative arc. Native SVG (the hand-rolled-chart aesthetic). Fields: `events[] {at,
  label, detail?}`, optional `lanes`.
- **`figure`** — *the* humanities primitive Ascent lacks: a labeled diagram. A base visual (a
  model-drawn vector scene **or** a provider-sourced image, §6) plus callout labels with leader
  lines pointing at parts. "The parts of X": anatomy, a cathedral, a sonnet's structure, a
  staff. Fields: `figure {svg? | mediaId?}`, `labels[] {text, at:{x,y}}`.
- **`graph`** — node–link relationships: causes, influences, who-shaped-whom, taxonomies.
  Rendered app-side with d3 (`d3-force` / `d3-hierarchy`, §8) from model-emitted `nodes[]` /
  `edges[]`. Reliable *because the model emits data, not code*.
- **`spectrum`** — place items along a continuum (a political spectrum, Mohs scale, a gradient
  of -isms). Simple, high-reuse, no good primitive today. Fields: `axis {min,max,labels}`,
  `items[] {label, at}`.
- **`map`** — geographic. App-layer `d3-geo` + bundled TopoJSON (§8) for modern/thematic maps
  (pins, routes, choropleth) from model-emitted data; historical maps come from providers (§6)
  as a `figure`/`media`. Fields: `projection`, `marks[] {kind, coords|region, label}`.
- **`media`** — a provider-sourced asset (image v1; video/embed/generated reserved, §6) or a
  small gallery. Placeholder block: `mediaId` + `query` + `purpose`; the asset is resolved by a
  parallel job into the `media_assets` table, mirroring widgets.
- **chart upgrade** — keep the hand-rolled `chart` for illustrative shapes; optionally route
  richer/real-data charts through `d3-scale`/`d3-shape` (§8) without changing the block's
  author-facing contract.

Widgets (§5) remain the bespoke-interaction escape hatch — unchanged contract, plus d3.

## 5. Generative widgets — existing path, + d3

The widget path is already built: AI-coded `function Widget()` → `sucrase` compile
([core/widgets/compile.ts](../../../src/core/widgets/compile.ts)) → sandboxed `srcdoc` iframe
with **no** `allow-same-origin` ([widgetFrame.ts](../../../src/ui/blocks/widgetFrame.ts),
[widget-runtime/runtime.ts](../../../src/widget-runtime/runtime.ts)), parallel jobs in
[widgetJobs.ts](../../../src/core/generation/widgetJobs.ts), Haiku by default via
`getModelFor("widget")`.

Change: add **modular d3** to the widget runtime bundle so generated widgets can use `d3.*` for
bespoke interactions (e.g. a draggable force layout the learner perturbs). This is one bundle
addition to `src/widget-runtime/runtime.ts`.

Honest caveats (carry forward from the widgets spec):
- d3 in the sandbox inherits the Haiku-quality risk *and* the d3-vs-React "two masters of the
  DOM" tension. **Most d3 value lives in the app layer (§8), not here.** Sandbox d3 is for
  genuinely novel interaction only.
- The runtime is inlined into every widget `srcdoc`; d3 grows that payload. Spike #4 measures
  it; if heavy, include only the d3 submodules widgets actually need, or gate d3 widgets behind
  a Sonnet route.

## 6. Media provider system — content-agnostic from day one

The user's explicit refinement: **do not lock providers to images.** Image is the first
`MediaKind`; the convention must scale to video, YouTube-style embeds, AI-generated images, and
audio across many configurable integrations. So the abstraction is content-agnostic; only the
**image** kind + **Wikimedia Commons** provider are *implemented* in v1.

### 6a. Types (`src/core/media/types.ts`)

```ts
type MediaKind = "image" | "video" | "embed" | "generated-image" | "audio"; // extensible

interface MediaQuery { kind: MediaKind; query: string; filters?: Record<string, string>; }
interface License { id: string; name: string; url?: string; requiresAttribution: boolean; }

// Kind-specific payloads — a discriminated union, NOT one baggy shape.
type MediaPayload = ImagePayload | EmbedPayload | GeneratedPayload | AudioPayload;
interface MediaResult {
  kind: MediaKind; providerId: string; payload: MediaPayload;
  license: License; attribution: { author?: string; sourceUrl: string; title?: string };
}

// A provider DESCRIBES a request; it never performs network I/O itself.
interface RequestDescriptor {
  url: string; method: string; headers?: Record<string, string>; body?: string;
  secretAccount?: string;   // names the Keychain secret Rust injects (provider:<id>) — never in JS
}

// Base metadata every provider has.
interface MediaProviderMeta {
  id: string;               // "wikimedia" | "openverse" | "youtube" | "met" | ...
  label: string;
  kinds: MediaKind[];
  needsKey: boolean;        // → Keychain secret under `provider:<id>`
  licenseDefault?: string;
}

// Capabilities are SEPARATE interfaces — a provider implements only what it does,
// avoiding a lowest-common-denominator shape across Wikimedia / YouTube / generators.
interface SearchableMediaProvider extends MediaProviderMeta {
  buildSearch(q: MediaQuery): RequestDescriptor;
  parseSearch(body: unknown): MediaResult[];
  buildFetch(r: MediaResult): RequestDescriptor;     // resolve the chosen asset's bytes
}
interface GenerativeMediaProvider extends MediaProviderMeta {
  buildGenerate(prompt: string, opts: GenerateOpts): RequestDescriptor;
  parseGenerate(body: unknown): MediaResult;
}
interface EmbeddableMediaProvider extends MediaProviderMeta {
  buildEmbed(r: MediaResult): EmbedDescriptor;       // oEmbed/iframe, sandboxed (§6e)
}
```

**The JS/Rust boundary, resolved.** A provider adapter is **pure TypeScript**: it *builds*
request descriptors and *parses* response bodies — the provider-specific logic, where 40
integrations are cheap to add. It performs **no network I/O**. The only code that touches the
network is the Rust executor, which takes a descriptor, injects the named Keychain secret, runs
the request, and hands the raw body back for the adapter to parse. This is exactly the
`ai_request` boundary already proven at
[service.ts:144](../../../src/core/ai/service.ts) — SDK/adapter in JS builds the request, Rust
executes it with the key. Keys never enter JS; CORS + caching stay in one place; **new providers
are pure-TS modules with zero Rust changes.**

Honest boundary of the convention: providers needing streaming, OAuth refresh, or bespoke
transport don't fit "describe a request, Rust runs it" — those register a dedicated Rust command
plus a thin TS facade. v1 (Wikimedia search + image fetch) is plain REST and fits the descriptor
model cleanly; the escape hatch exists for later.

### 6b. Registry + configuration (`src/core/media/registry.ts`)

`providerRegistry`: `register(p)`, `list()`, `providersFor(kind)`, `enabled()`. The set of
enabled providers and their non-secret options live in settings (localStorage, like the rest of
settings); **secrets live in the macOS Keychain** via the existing
[`secretStore`](../../../src/core/secrets.ts) (`set_secret`/`has_secret`,
[secrets.rs](../../../src-tauri/src/secrets.rs)) keyed `provider:<id>` — the exact pattern the
Anthropic key already uses. Settings grows a "Sources" section: a list of providers with
enable toggles + key fields for `needsKey` providers. This is where "40 integrations,
configurable" lives, with zero new secret-handling code.

### 6c. Resolution flow (mirrors widgets exactly)

1. Lesson/Planner emits a `media` (or `figure` with `mediaId`) placeholder: `mediaId` +
   `query` + `purpose` (+ optional `kind`, default `image`). The block carries no URL.
2. A module-level `mediaJobs` registry (clone of `widgetJobs.ts`: dedupe, abort, status via
   `useSyncExternalStore`, watchdog, survives navigation) resolves it: pick enabled
   `providersFor(kind)` → `buildSearch` → Rust executor → `parseSearch` → rank/pick
   (license-filter first, then a relevance heuristic; the model may refine the query, but
   selection is app-side) → `buildFetch` → Rust downloads + caches bytes → write a
   `media_assets` row with license + attribution.
3. Renderer joins block → row via `useMedia(conceptId, mediaId)`; publishes with
   `queryClient.setQueryData(["media", conceptId, mediaId], row)`. The model never sees a URL.

### 6d. Network + cache through Rust

The Rust side is **generic** — it executes descriptors and knows nothing provider-specific (that
all lives in the TS adapters, §6a). Two commands in `src-tauri/src/media.rs`, reusing the shared
client in [transport.rs](../../../src-tauri/src/transport.rs):

- `media_request(descriptor)` → returns the response text (search/generate JSON); TS parses it.
- `media_download(descriptor)` → streams the asset bytes to the local media cache dir, returning
  `{ localPath, contentType, width?, height? }` (never loading a large binary into JS as text).

Both inject the descriptor's named Keychain secret in Rust — the key never enters JS — the same
boundary as `ai_request`/`ai_stream` ([ai.rs](../../../src-tauri/src/ai.rs)). This handles CORS,
gives one auditable network surface, and caches assets (+ a `media_assets` row) so lessons reopen
offline with attribution intact. **No `media_*` command is provider-aware; adding a provider adds
no Rust.**

### 6e. Security & licensing (non-negotiable)

- **License-first.** Default to public-domain / permissive-CC results; render visible
  attribution (author + source link) wherever a `requiresAttribution` asset appears. A
  `figure`/`media`/gallery without attribution is a bug.
- **Sanitize.** Provider SVGs/HTML are untrusted: render images as `<img>` from the local
  cache, never inline a remote SVG; embeds (future) render only in a **sandboxed iframe with an
  origin allowlist** — never the main frame, same philosophy as widgets.
- **Offline-graceful.** Provider disabled / offline / a miss degrades to the spec text or a
  vector `figure`; it never breaks a lesson (prose stands alone, like a failed widget).

DIRECTIVE: provider keys go through `secretStore` (Keychain) and provider fetches through the
Rust `media_*` commands. Never put a provider key in JS/localStorage; never fetch a provider
directly from the webview.

## 7. d3 strategy — modular, two layers

- **Dependencies:** add `d3-scale`, `d3-shape`, `d3-array`, `d3-hierarchy`, `d3-force`,
  `d3-geo`, `topojson-client` (submodules, not the `d3` meta-package). Lazy-loaded chunks, same
  discipline as `katex` / `mermaid` / `pyodide` — the main bundle stays lean.
- **App layer (primary, reliable):** `graph`, `map`, hierarchy/treemap, and richer charts.
  Model emits *data*; deterministic renderers in `src/ui/blocks/` use d3. This is where ~80% of
  "d3 versatility" actually wants to live and it sidesteps AI-writes-d3 entirely.
- **Sandbox (secondary, bespoke):** d3 in the widget runtime for novel interactions only (§5).
- **Maps need data, not just a library:** bundle `world-atlas` TopoJSON (world + countries; US
  states optional) for `d3-geo`. Historical/thematic basemaps come from providers (§6). The
  model never emits geometry.

## 8. The `viz` lens

`LensId` already reserves `"viz"` ([types.ts:5](../../../src/core/types.ts)). Light it up: a
right-pane lens that indexes a lesson's visuals — a gallery/enlarge view, re-run an interaction
full-size, and (for `media`) the attribution + license detail. A lesson declares the `viz` lens
when it emits ≥1 visual beyond plain prose (same derivation as `code` today in `lesson.ts`).

## 9. Per-task model routing extensions

Extend `AI_TASKS` ([tasks.ts](../../../src/core/ai/tasks.ts)) with the new generation tasks so
each is independently configurable, continuing the migration the widget task started:

- `director` — the completeness pass (§3b); cheap model by default (Haiku).
- `figure` — model-drawn SVG figures (§4 `figure`, when not provider-sourced); the quality-risk
  task, easy to bump to Sonnet via Settings.
- (`graph`/`timeline`/`spectrum`/`map` data are emitted inside the main `lesson` call, no new
  task; `media` resolution is largely non-model, so no task unless query-refinement earns one.)

DIRECTIVE: new visual generators resolve through `getModelFor(task)`, never a hardcoded model —
the rule the widget path established.

## 10. Data model additions

- **`media_assets`** table + `mediaRepo` (get/upsert/listByConcept), keyed `(conceptId,
  mediaId)`: `kind`, `providerId`, `query`, `status` (`generating|ready|failed`), `localPath`,
  `width`/`height`, `license` (json), `attribution` (json), `error`, `createdAt`, `updatedAt`.
  Bytes on disk in a media cache dir; the row is the index. Same race-avoidance rationale as the
  `widgets` table — a resolve job must never collide with the streaming lesson upsert.
- **Block** ([types.ts](../../../src/core/types.ts)) keeps its flat, model-friendly shape,
  gaining optional fields for the new kinds: `events`/`lanes` (timeline), `figure`/`labels`
  (figure), `nodes`/`edges` (graph), `axis`/`items` (spectrum), `projection`/`marks` (map),
  `mediaId`/`query`/`purpose` (media), plus model-authored **alt text** (`alt`) on every visual
  block (figures/maps also emit a `<desc>`) — accessibility is each plugin's contract
  (`requiresAltText: true`). The flat shape stays for generation and persistence, but
  **renderers and logic never reason over the mega-interface**: each kind's `schema` fragment
  (the `visualAuthoring` facet, §2) yields a per-kind type via `z.infer` plus a guard
  (`isTimelineBlock(b)`, …), so a renderer narrows to exactly its kind's fields and invalid
  cross-kind states stay unreachable.
- **Provider config** in settings (localStorage); **provider secrets** in Keychain via
  `secretStore` (§6b). No plaintext keys anywhere.
- Drizzle migrations via the existing `db_execute` path
  ([migrate.ts](../../../src/core/store/migrate.ts)).

## 11. Spikes (riskiest-first — lock details only after these)

Per the project's "verify integrations with runnable spikes before locking" rule:

1. **Rust media fetch + cache + CORS (Wikimedia).** Prove the generic `media_request` /
   `media_download` executors round-trip a Wikimedia search → an openly-licensed image with
   license+attribution, cache locally, and replay offline — driven by a pure-TS Wikimedia
   adapter (`buildSearch`/`parseSearch`/`buildFetch`). Largest new subsystem; gates §6.
2. **Model-drawn `figure` quality.** Have the `figure`/lesson model produce an annotated SVG
   figure for a humanities concept; compare freeform SVG vs a constrained figure-schema
   (shapes+labels+leaders). Decides how much structure §4 `figure` imposes. The quality
   wildcard.
3. **App-layer d3 map.** Render a TopoJSON world map with model-emitted pins/choropleth;
   confirm bundle weight is acceptable and lazy-loads cleanly.
4. **Sandbox d3 size.** Add d3 to the widget runtime; measure `srcdoc` size per iframe; confirm
   a generated d3 widget runs under `sandbox="allow-scripts"` with no same-origin.
5. **Planner coverage uplift.** A/B several non-STEM lessons with vs without the domain budget
   (3a) + completeness pass (3b); measure visual-coverage uplift. Validates the core premise and
   decides whether 3b survives.

## 12. Build order (by dependency/risk, not gated rollout)

Development cost is treated as ~0, so there is no phased gating — but build order still matters:

- **Foundation:** the registry facets (§2: catalog / authoring / renderers / jobs) + prompt
  assembly from `visualAuthoring` + per-kind guards (§10). Unblocks everything; mostly mechanical,
  refactors `lesson.ts`'s prompt and `LessonPane`'s dispatch.
- **Coverage-thesis validators (do these next — smallest possible surface):** `timeline` +
  `spectrum`. Pure native SVG: no d3, no media, no spike. With the domain budget (3a) they prove
  the registry works end-to-end *and* that prompting actually lifts non-STEM coverage — **run
  spike #5 here**, before committing to the heavy subsystems below. If the thesis doesn't hold on
  these, that's cheap to learn now.
- **`figure` (vector first):** native SVG labeled diagrams; spike #2 settles freeform-vs-schema.
- **d3 app layer:** `graph`, `map` (d3 submodules + TopoJSON; spike #3).
- **Provider system:** image + Wikimedia + generic Rust executors + cache + attribution +
  Settings "Sources" (spike #1) — the big one, content-agnostic so later kinds/providers are
  additive.
- **Planner completeness pass (3b):** only if spike #5 showed the budget alone left coverage gaps.
- **Sandbox d3 + provider-sourced figures:** small adds after spike #4 and the provider system.

## 13. Honest complexity & caveats

- **Media provider subsystem is the largest new surface** (Rust routing, Keychain reuse, disk
  cache, license/attribution rendering, offline). Architecturally clean because every piece
  reuses an existing pattern — but it is a real subsystem.
- **Model-drawn SVG figures are the quality wildcard** (spike #2). The provider path is the
  hedge: where a real image fits, prefer it; vector figures cover the offline/abstract cases.
- **d3-in-sandbox** inherits Haiku-quality + payload-size caveats; the design deliberately
  pushes d3 to the app layer to avoid leaning on it.
- **The Planner must prove itself** (spike #5) or 3b is complexity that doesn't pay. 3a (the
  prompt budget) is cheap and almost certainly worth it regardless.
- **Licensing is a correctness/legal surface**, not a nicety: default-permissive + always-render
  attribution.

## Out of scope (this vision's v1)

- Non-image `MediaKind`s *implemented* (video, embed/YouTube, generated-image, audio) — the
  **convention** supports them (§6); only image + Wikimedia ship first.
- Generative-image providers (cost + a different trust model); `media_generate` is reserved.
- OAuth provider auth (only API-key-in-Keychain in v1).
- App↔widget bridge / widgets or visuals writing app state (mastery, forks) — still out, per the
  widgets spec.
- Cross-session persistence of in-widget interaction state.
- Shared/exported visuals, visual galleries across topics.
