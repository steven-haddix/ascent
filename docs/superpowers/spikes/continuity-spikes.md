# Continuity Engine — Spike Harnesses (run live)

These validate the **quality** premises the Continuity Engine rests on. They need a running app + a configured provider key (live models), so they are run by a human, not in CI. Each says what to do, what "pass" looks like, and what to change if it fails.

> The engine is already built and wired (Wave 1). These spikes decide prompt tuning and whether later amplification (SemanticIndex, self-heal auto-revise) is worth it — they are not blockers for the felt-win landing.

## Spike #2 — Canon authoring quality from the outline

**Question:** Does `getModelFor("canon")` produce a *spine + notation + prereq graph* good enough to ground "builds on" **without embeddings**?

**Steps**
1. Start a real topic with some cross-tree structure (the ML demo topic is a good stress test: "Modern Large Language Models" or "Neural Networks from Scratch").
2. After the tree appears, the canon seeds in the background (`seedCanon`, fire-and-forget). Inspect the persisted row:
   ```sql
   select spine, notation, motifs, voice, prereqs from course_canon where topic_id = '<id>';
   ```
   (Use the app's SQLite file, or add a temporary `dlog` in `seedCanon`.)

**Pass when**
- `spine.order` lists every concept once in a sensible foundational→advanced order.
- `prereqs` captures real cross-tree "builds on" edges (e.g. "Attention" builds on "Embeddings"), not just parent/child containment.
- `notation` is sane for technical topics (and empty for non-technical ones).

**If it fails:** tune the `seedCanon` prompt in `src/core/generation/canon.ts` (the prereq instruction is the highest-value lever). If the prereq graph is weak, that raises the value of the Wave-6 SemanticIndex (B7) as the robustness layer.

## Spike #3 — Cohesion actually lands (the core premise)

**Question:** With the continuity context + handoff prompt, does a lesson genuinely **build on** prior lessons (precise references, no re-motivation) **without hallucinating** a prior lesson?

**Steps**
1. Generate a *sequence* of lessons along one branch (parent → child → grandchild), visiting them in order so each one's digest is produced before the next generates.
2. Read the later lessons. Check the continuity behaviors:
   - **Bridges in:** opens by connecting to the referrer/parent (the "Previously" band shows the recap; the prose picks up the thread) rather than re-introducing the whole subject.
   - **Precise back-references:** names specific prior lessons ("the gradient we met in Optimization"), not vague "as we discussed".
   - **Canonical notation:** reuses the same symbols/terms across lessons.
   - **Closes open loops:** if a parent digest left an open loop this lesson answers, it says so.
   - **No hallucinated references:** every "we saw X earlier" maps to a real prior lesson that was actually injected.

**A/B (to attribute the uplift to continuity):** compare against the pre-continuity build — `git stash` or check out `main` (continuity returns `""` when there is no canon/digests, which is also a rough proxy: a brand-new topic's first lesson has no continuity and reads "amnesiac"). The felt difference should be visible by the 2nd–3rd lesson on a branch.

**Pass when** later lessons read as the next beat of one course and references are accurate.

**If it fails:**
- *Model ignores the context* → strengthen the CONTINUITY RULES ordering/empahsis in `formatContinuitySection` (`src/core/generation/continuity.ts`).
- *Model hallucinates prior lessons* → tighten the "NEVER reference … not listed here" directive; this is also what the Wave-6 self-heal drift-check (spike #1) is meant to catch after the fact.

## Spike #1 — Self-healing drift-check precision (Wave 6)

Deferred to Wave 6 (self-healing). Default there is **detect-and-flag-only**; auto-revise is gated on this spike showing the fast `coherence` model reliably distinguishes real drift from noise. See the Wave 6 tasks.
