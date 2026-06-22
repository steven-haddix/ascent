# Visual Learning System — Spike Harnesses (run live)

Quality/coverage premises that need real models + (later) the network. Run by a human.

## Spike #5 — Planner coverage uplift (the core premise) — RUN NOW

**Question:** Does the **domain-aware visual budget (§3a)** actually lift visual coverage on non-STEM lessons — enough that visuals "show up at all" in humanities? This decides whether the heavier **completeness pass (§3b, Wave 7)** is worth building.

**Steps**
1. Pick 4–6 non-STEM concepts across domains: a history event ("Causes of WWI"), a biography, an arts/music structure, a law/political-spectrum topic, a language topic.
2. Generate each lesson on the current build (budget ON — `buildLessonPrompt` injects the `VISUAL BUDGET` line + the timeline/spectrum guidance from `visualAuthoring`).
3. A/B: regenerate the same concepts on `main` (budget OFF — pre-Wave-2 build) or temporarily stub `budgetLine = ""` + `assembleVisualGuidance()` → `""`.
4. Count visual blocks per lesson (timeline / spectrum / chart / diagram / table) in each arm.

**Pass when** the budget arm reliably produces ≥1 relevant non-prose visual on lessons that the OFF arm returns as a wall of prose — and the visuals are *relevant* (a real timeline for a chronological topic), not decorative.

**Decision:**
- Strong uplift → ship 3a alone; **drop the §3b completeness pass** (don't build unproven complexity). Note that in the Wave-7 task.
- Marginal uplift → keep 3a and build the §3b append-only completeness pass (Wave 7) as the safety net.

**Levers if weak:** strengthen the `VISUAL BUDGET` wording or the per-kind `guidance` in `src/core/visuals/authoring.ts`; adjust `affinity` in `src/core/visuals/catalog.ts`; sharpen `inferDomain` keywords.

## Spike #2 — Model-drawn `figure` quality (Wave 3)
Compare freeform model SVG vs a constrained figure-schema (shapes + labels + leader lines) for a labeled humanities diagram (anatomy, a cathedral, a sonnet's structure). Decides how much structure the `figure` kind imposes. Deferred to the Wave-3 `figure` task.

## Spike #3 — App-layer d3 map (Wave 3)
Render a TopoJSON world map with model-emitted pins/choropleth; confirm bundle weight is acceptable and the d3 submodules + `world-atlas` lazy-load cleanly. Deferred to Wave 3.

## Spike #1 — Rust media fetch + cache + CORS, Wikimedia (Wave 4/5)
Prove `media_request`/`media_download` round-trip a Wikimedia search → openly-licensed image with license+attribution, cache locally, replay offline — driven by a pure-TS Wikimedia adapter. The largest new subsystem; deferred to the Wave-4/5 provider work.

## Spike #4 — Sandbox d3 size (Wave 5) — DONE (measure in-app)
d3 (scale/shape/array/force) is injected as a `d3` global in the widget runtime
(`src/widget-runtime/runtime.ts`). Measured bundle: **`public/widget-runtime.js` ≈ 0.31 MB**
(was ≈ 0.15 MB React-only). This runtime is inlined into every widget `srcdoc`, so a lesson
with several widgets repeats it. **Verify in-app:** a generated d3 widget runs under
`sandbox="allow-scripts"` (no same-origin) and renders. **If heavy:** trim to the submodules
widgets actually use, lazy-load d3 inside the srcdoc, or gate d3 widgets behind a Sonnet route
(per the widgets-spec caveat). The widget builder prompt now lists d3 as math/layout-only.
