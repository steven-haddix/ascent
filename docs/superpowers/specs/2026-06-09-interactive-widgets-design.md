# Interactive Widgets — Design

**Date:** 2026-06-09
**Status:** Approved direction (generated code from day one; self-contained v1; lesson gen + chat entry points; per-task model routing)

## Goal

Lessons and chat can create **inline interactive widgets** — higher-fidelity interactions than
markdown/LaTeX/charts: a slider that animates gradient descent, a step-through of an algorithm,
a draggable decision boundary. Widgets are **AI-generated React components**, built by a
**separate, cheaper subagent** while the primary lesson author keeps writing prose. The lesson
agent emits only a placeholder (title + spec); a parallel widget job writes, compiles, and
renders the actual component.

The handoff is the v1 architecture, not a later optimization, for three reasons:

1. **Schema discipline.** `LessonSchema` already stalls Anthropic native structured output and
   runs in `jsonTool` mode (M8 gotcha #1). The placeholder adds three string fields; the full
   widget payload never touches the lesson schema.
2. **Cost + focus.** Widget code generation routes to a cheaper model (Haiku default) and takes
   zero context from the lesson author.
3. **Parallelism.** Widget jobs start mid-stream, as soon as their placeholder settles, and
   finish concurrently with the prose.

## 1. Block shape

New `Block` kind in `src/core/types.ts` and `LessonSchema` (`src/core/generation/lesson.ts`):

```ts
kind: "widget"
widgetId: string  // short kebab slug the model mints, unique within the lesson
                  // e.g. "gradient-descent-slider"
title: string     // 3-7 words, shown on the placeholder/card header
spec: string      // 2-5 sentences: what it shows, what the learner manipulates,
                  // what they should notice
```

App-side guards: validate/normalize the slug (kebab, length-capped); if missing or duplicated
within the lesson, derive one from `title` + a numeric suffix. `isRenderableBlock` requires a
non-empty `spec`.

Prompt addition (lesson + same guidance reused for chat): a widget earns its place only when
*doing* beats *reading* — an interaction the learner manipulates, not decoration. Guideline
0–2 per lesson. A good `spec` names the variables the learner controls, what responds, and the
insight the interaction should produce. The spec is the full contract — the widget builder sees
the spec and concept context, not the lesson prose.

## 2. Data model

Widget payloads live in a **new `widgets` table**, never inside `lesson.blocks`. This is
load-bearing: a widget job finishing must never race the still-streaming lesson's final
`lessonRepo.upsert`. Keyed by `(conceptId, widgetId)`:

```ts
interface WidgetRow {
  conceptId: string;
  widgetId: string;          // slug from the block
  title: string;
  spec: string;
  status: "generating" | "ready" | "failed";
  source: string | null;     // JSX the model wrote (kept for revise/debug)
  compiled: string | null;   // sucrase output — what the iframe runs
  error: string | null;      // last compile/render error (failed status)
  attempts: number;
  model: string;             // model id that produced `source`
  createdAt: number;
  updatedAt: number;
}
```

Drizzle schema + `widgetRepo` (get/upsert/listByConcept), following the existing repo pattern.
The renderer joins block → row via a `useWidget(conceptId, widgetId)` TanStack Query hook;
widget jobs publish with `queryClient.setQueryData(["widget", conceptId, widgetId], row)`.
Lesson regeneration may orphan rows (harmless); a re-emitted same slug overwrites.

## 3. Pipeline: placeholder → parallel widget job

`src/core/generation/widgetJobs.ts` — a module-level registry mirroring `lessonStreams.ts`:
keyed by `` `${conceptId}:${widgetId}` ``, with dedupe (`running` set), abort controllers,
status snapshots via `useSyncExternalStore`, and an idle watchdog. Jobs survive navigation;
returning re-attaches.

**Kickoff during the lesson stream.** The `onPartial` handler in `ensureLessonStream` scans
partial blocks for widget blocks that have **settled** — a later block has started streaming
after them, or the stream has ended — so `spec` is no longer growing. Each settled placeholder
calls `ensureWidgetJob(concept, block)`; registry dedupe makes the scan idempotent across
hundreds of partials. The same scan runs once more on stream completion (catches a widget as
the final block).

`ensureWidgetJob` upserts a `generating` row, then runs the generate → compile → (render-gate
on mount) loop below.

## 4. Sandboxed runtime — the security boundary

Generated code **never runs in the main webview frame**. In Tauri the main frame reaches IPC
(`ai_request`, the SQLite store); model-written code must not.

- Render in `<iframe sandbox="allow-scripts">` — critically **no** `allow-same-origin` —
  with a `srcdoc` assembled from:
  - React + ReactDOM UMD, bundled as local static assets, fetched once and inlined (cached
    in-memory module-level);
  - a small runtime shim: error boundary, `window.onerror`/`unhandledrejection` hooks,
    `ResizeObserver` posting height;
  - the app's CSS design tokens (`--ink`, `--surface`, `--accent`, `--rule`, …) extracted from
    the current theme so widgets look native and follow theme switches (re-render srcdoc on
    theme change);
  - the compiled widget code + `ReactDOM.createRoot(...).render(<Widget/>)`.
- Opaque origin + no parent access ⇒ no Tauri IPC, no storage, no credentialed network.
  `postMessage` is the only channel, child → parent: `ready`, `error {message, stack}`,
  `resize {height}`. No parent → child messages in v1 (widgets are self-contained).
- **CSP note:** `tauri.conf.json` has `csp: null` today, so inline srcdoc scripts work. If a
  production CSP is ever added, it must permit the widget iframe (`frame-src`/sandbox srcdoc +
  script needs). DIRECTIVE: revisit this spec's runtime section before tightening CSP.
- **Spike #1 (gates everything):** verify Tauri 2 on macOS WKWebView does **not** expose
  `__TAURI_INTERNALS__` / IPC inside a sandboxed srcdoc iframe. If it does, escalate isolation
  before shipping anything.

## 5. Generation contract & reliability loop

The widget subagent prompt: concept title/path, the `spec`, the runtime contract, hard
constraints:

- Emit **one** function component `function Widget()`. JSX allowed. **No imports** — `React`
  (with hooks) is in scope. No `fetch`, no `window.parent`/`top`, no external assets/CDNs.
- Style with inline styles + the provided CSS custom properties; SVG strongly encouraged for
  visuals (matches the app's hand-rolled-chart aesthetic). Self-contained state via hooks.
- Output is **plain text** (fenced code block extracted app-side), not structured output —
  code quality degrades inside JSON strings, and structured output is the known stall risk.

Three gates, because generated code fails in ways schemas can't catch:

1. **Compile gate** — `sucrase` (new dep, lazy-loaded chunk like katex/mermaid) transforms
   JSX→JS at generation time; syntax errors caught here. Compiled output stored on the row.
2. **Render gate** — the sandbox shim posts `error` on boundary catch / window error; the
   mounted `WidgetBlock` reports the failure back into the job/row.
3. **Retry** — on either failure, one automatic retry with the error appended ("your previous
   attempt failed with: …"). After `attempts >= 2` → `status: "failed"`; the card shows spec +
   muted error + manual Retry. A failed widget never breaks the lesson — prose stands alone.

## 6. Per-task model routing (new pattern, started here)

Every AI use case gets an addressable task id so model/provider/settings can diverge per use
case without touching call sites again.

- `src/core/ai/tasks.ts` (dependency-free, like `models.ts`): task registry —
  `"lesson" | "widget" | "tutor" | "teachback" | "quiz" | "micro" | "intake" | "outline"` —
  each optionally declaring a `defaultModelId`. `widget` defaults to `MODELS.fast` (Haiku).
- `settings.ts`: `getTaskRouteId(task)` / `getTaskModelId(task)` reading
  `ascent-route:<task>` / `ascent-model:<task>`, falling back to the existing global keys,
  validated against the task route's catalog (same fallback rule as `getModelId`).
- `service.ts`: `getModelFor(task)` beside `getModel()` — resolves the task's route + model and
  passes the task id to `recordingMiddleware`, so per-use-case cost shows up in usage tracking.
- **Migration policy:** only new widget code calls `getModelFor` in v1. Existing `getModel()`
  call sites are untouched and migrate mechanically when each use case earns a settings knob.
- Settings UI v1: a single "Widget model" picker in the model section (default Haiku, option to
  inherit the global model). A full per-task matrix is future work.

Honest caveat: Haiku writing novel interactive JSX is the weakest link in this design. The
retry loop and tight contract mitigate; if quality disappoints, switching widgets to Sonnet is
a settings change, not a code change.

## 7. Entry points

- **Lesson generation:** prompt section (see §1) teaching when/how to emit widget placeholders.
- **Chat:** `setLessonWidget` tool in `tutor.ts` mirroring `setLessonCode` —
  `mode: "add" | "replace"`, fields `title` + `spec`. Inserts the placeholder block
  (`source: "chat"`), upserts the widget row, kicks `ensureWidgetJob`. Replace targets the most
  recent chat-added widget block and reuses its slug; the replace job receives the previous
  `source` as context, so "make the slider logarithmic" iterates instead of starting over.
  Refuses while `isLessonStreaming(conceptId)` (same guard as code).

## 8. Rendering states

`src/ui/blocks/WidgetBlock.tsx`, collapsible-card chrome like `CodeBlock`, wrapped in the
existing `ErrorBoundary`:

- **generating** — skeleton card: title, spec text, shimmer.
- **ready** — sandboxed iframe; height auto-fitted from `resize` messages, capped (~520px).
- **failed** — spec + muted error + Retry button (re-runs `ensureWidgetJob` with attempts reset).

## 9. Testing & spikes

- **Spike #1:** IPC isolation in sandboxed srcdoc iframe (must pass first).
- **Spike #2:** sucrase compile + React UMD srcdoc render end-to-end with a *hand-written*
  widget — prove the runtime before any AI is involved.
- Unit: settling detection in the partial scanner; fenced-component extraction; slug
  normalization/dedupe; `setLessonWidget` replace-mode splice (pattern proven for code).
- Live smoke: a lesson on gradient descent produces a working slider widget; chat "add a widget
  for X" path; theme switch restyles a mounted widget.

## Out of scope (v1)

- App bridge (widgets writing mastery, forking concepts, any parent → child messaging).
- Persisting learner state inside widgets across sessions.
- Non-React payloads; a declarative widget archetype library (revisit if code-gen reliability
  disappoints).
- A `viz` lens; widget galleries; sharing.
