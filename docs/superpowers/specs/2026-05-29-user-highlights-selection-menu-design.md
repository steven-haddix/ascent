# User-Driven Highlights & Selection Menu — Design

**Date:** 2026-05-29
**Status:** Approved (brainstorm complete; momentum approved for implementation)

## Problem

Lessons already let a learner click an LLM-tagged term to get a quick-action popover
(`TermPopover` → Fork). But if the model didn't tag a phrase the learner wants to dig
into, there's no affordance. We want the learner to **select any prose** and get the
same kind of menu, with actions appropriate to a free-text selection — and we want those
selections to **persist as a personal highlight layer**.

## Decisions (from brainstorm)

- **Same shell.** Reuse the exact `TermPopover` visual design (title + chip + italic
  gloss + divider + action buttons + mono footer). Extract it into one shared
  `QuickActionPopover`; both the term-click path and the selection path are presets, so
  they can never visually drift.
- **Actions:** Fork branch, Define inline, Ask the tutor, Copy. Plus a conditional
  **Go to "&lt;Title&gt;"** when the selection already matches a concept in the tree, and a
  **Remove** action when the popover is opened from an existing saved highlight.
- **Fork** = small-model (`claude-haiku-4-5`) normalizes the selection → `{title, summary}`,
  then routes through the existing `onFork`/`handleFork`, which runs `findExistingConcept`
  (dedup → link instead of duplicate) before creating the child.
- **Define inline** = on-demand only (no LLM cost until clicked). A Haiku call fills the
  gloss row in place and saves it onto the highlight.
- **Ask the tutor** (the "Explain" idea) = opens the ChatDrawer and **auto-sends** a
  prefilled, lesson-context message; the tutor streams the answer.
- **Persistence** = a `highlights` table. A highlight is saved when the learner takes a
  substantive action (Define / Fork / Ask / Go-to). Plain Copy does not persist. Saved
  highlights re-render in their own style (distinct from the accent-orange LLM terms) and
  clicking one reopens the popover (with any saved gloss + Remove).
- **Anchoring** = quote + context (TextQuoteSelector): store `exact` + ~32 chars of
  `prefix`/`suffix`; re-locate by searching the block text on render. No lesson-schema
  changes; degrades gracefully (an unresolvable highlight is silently skipped, never
  deleted).

## Architecture

### Data
- New table `highlights(id, conceptId→concepts.id, exact, prefix, suffix, gloss?, createdAt)`.
  No DB unique index; de-duplication by anchor is done in `useAddHighlight` (returns the
  existing id and updates its gloss rather than inserting a twin).
- `Highlight` type in `types.ts`; `HighlightRow`/`HighlightInsert` inferred in `repositories.ts`.
- Migration generated via `bunx drizzle-kit generate` (journal-tracked).

### Pure, testable modules (the engineering risk, isolated)
- `src/core/highlights/anchor.ts` — `buildAnchor`, `locateAnchor`, `nearestOccurrence`,
  `occurrences`, common-prefix/suffix helpers. No DOM, no React.
- `src/ui/blocks/marks.ts` — `findTermHits`, `mergeMarks`: given a text run, a set of term
  hits, and a set of located highlight ranges, produce ordered non-overlapping render
  pieces (splitting at boundaries where a term and a highlight overlap).

### Generation
- `src/core/generation/micro.ts` — `defineInline(selection, ctx)` and
  `normalizeConcept(selection, ctx)`, both on `MODELS.fast` (Haiku) through the existing
  `getModel()` chokepoint (usage is auto-recorded). `normalizeConcept` returns
  `{title, summary}` (parsed from a strict `Title :: summary` reply, with the raw
  selection as fallback).

### Store hooks
- `useHighlights(conceptId)`, `useAddHighlight(conceptId)` (insert-or-update-gloss by
  anchor, returns id), `useRemoveHighlight(conceptId)`.

### Rendering
- `RichText` gains optional `highlights` (located ranges in block-text space) and
  `onHighlight`. `splitMathSegments` now also returns each segment's `start` offset so
  highlight ranges can be mapped into per-segment local coordinates. Term detection moves
  from regex-split to `findTermHits` so terms and highlights merge through `mergeMarks`.
- `LessonPane` places each highlight into the first paragraph block whose text the anchor
  resolves in (stable assignment), captures selections via an `onMouseUp` handler on the
  prose container (paragraphs are marked `data-prose data-block-index`; non-prose and
  cross-block selections are ignored), and owns a single discriminated popover state
  (`term` | `selection`).

### Wiring
- **Ask the tutor:** `AppShell` holds an `askDraft = {text, n}` state, passes
  `onAskTutor(text)` to `LessonPane` and `pending={askDraft}` to `ChatDrawer`; the drawer
  fires `submit(text)` in an effect keyed on `n`. `askDraft` clears on concept change so a
  stale draft never replays after navigation.
- **Fork / Go-to:** reuse the existing `onFork` callback (which already dedups + links +
  navigates). Go-to is just `onFork(matchTitle, …)`; Fork is `onFork(normalizedTitle, summary)`.

## Selection → block-text anchoring

At save time the selection lives in *rendered* DOM space; the highlight is stored in
*block-text* space:
1. Compute the rendered start offset of the selection within its paragraph element
   (`Range.selectNodeContents` + `setEnd`).
2. Find the occurrence of the selected string in `block.text` nearest that offset
   (`nearestOccurrence`).
3. `buildAnchor(block.text, start, end)` slices `prefix`/`suffix` from block text.

If the selected string can't be found in `block.text` (e.g. the selection crosses inline
math, whose rendered glyphs differ from the `$…$` source), the menu does not open — this
naturally excludes math without special-casing it.

## Out of scope (v1)
Cross-block selections, the ⌘/⌥ fork-queue hint, highlight colors/categories, a highlights
index/sidebar.

## Testing
- Unit (vitest, added in this work since no runner exists yet): `anchor.ts` (single match,
  multi-match disambiguation by context, no match → null, reordered/duplicate phrases) and
  `marks.ts` (term-only, highlight-only, overlap split, adjacency).
- Manual: select → Define / Fork / Ask / Copy / Go-to; revisit a lesson and confirm
  highlights re-render and reopen; remove a highlight; confirm a math-spanning selection
  is ignored.
