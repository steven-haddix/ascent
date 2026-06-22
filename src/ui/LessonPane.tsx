import { useRef, useState } from "react";
import type { ConceptRow } from "../core/store/repositories";
import type { Block, SuggestedFork, SuggestedLesson, Term } from "../core/types";
import { useConceptLesson, useHighlights, useAddHighlight, useRemoveHighlight, useLessonRow } from "../core/store/hooks";
import { PreviouslyBand } from "./PreviouslyBand";
import { SelfHealBanner } from "./SelfHealBanner";
import { refreshLesson, revertLesson, dismissStale } from "../core/generation/coherence";
import { findExistingConcept } from "../core/store/match";
import { buildAnchor, locateAnchor, nearestOccurrence, type Anchor } from "../core/highlights/anchor";
import { defineInline, normalizeConcept, type MicroContext } from "../core/generation/micro";
import type { LocatedHighlight } from "./blocks/marks";
import { TermPopover } from "./TermPopover";
import { QuickActionPopover, ForkIcon, type PopoverAction } from "./QuickActionPopover";
import { ErrorBoundary } from "./ErrorBoundary";
import { CodeBlock } from "./code/CodeBlock";
import { TableBlock } from "./blocks/TableBlock";
import { MathBlock } from "./blocks/MathBlock";
import { RichText } from "./blocks/RichText";
import { ChartBlock } from "./blocks/ChartBlock";
import { DiagramBlock } from "./blocks/DiagramBlock";
import { WidgetBlock } from "./blocks/WidgetBlock";
import { visualRenderers } from "./blocks/registry";
import { widgetKeysFor } from "../core/widgets/keys";
import { NextSteps, type RelatedItem } from "./NextSteps";
import { useLessonFind } from "./find/useLessonFind";
import { FindBar } from "./find/FindBar";

/** A block is renderable once it has the content its kind needs — guards against
 *  empty or half-streamed blocks. */
function isRenderableBlock(b: Block): boolean {
  switch (b.kind) {
    case "section":
      return !!b.label?.trim();
    case "table":
      return !!(b.headers?.length || b.rows?.length);
    case "chart":
      return !!b.series?.length;
    case "widget":
      // Must match widgetKeysFor's completeness rule, so the renderer's key map
      // (over filtered blocks) agrees with the stream scanner's (over raw blocks).
      return !!(b.title?.trim() && b.spec?.trim());
    case "paragraph":
    case "callout":
    case "code":
    case "math":
    case "diagram":
      return !!b.text?.trim();
    default:
      return false;
  }
}

/** Handlers + per-block highlights threaded into block rendering. */
interface BlockRender {
  onTerm: (t: Term, r: DOMRect) => void;
  onHighlight: (id: string, r: DOMRect) => void;
  /** located highlight ranges keyed by block index (block-text coordinates) */
  highlights: Map<number, LocatedHighlight[]>;
  /** widget row keys by block index (widgetKeysFor over the rendered blocks) */
  widgetKeys: Map<number, string>;
  conceptId: string;
  conceptTitle: string;
}

/** Render one block by kind. Visual kinds are wired in per slice; unknown or
 *  not-yet-handled kinds fall back to a paragraph. */
function renderBlock(block: Block, index: number, r: BlockRender) {
  // Visual registry first: additive visual kinds (timeline, spectrum, …) render through
  // their plugin; legacy/prose kinds fall through to the switch below.
  const visual = visualRenderers[block.kind];
  if (visual) {
    const Visual = visual.Component;
    return visual.isRenderable(block) ? <Visual key={index} block={block} conceptId={r.conceptId} /> : null;
  }
  switch (block.kind) {
    case "section":
      return <SectionHead key={index} block={block} />;
    case "callout":
      return <Callout key={index} block={block} />;
    case "code":
      return <CodeBlock key={index} block={block} />;
    case "table":
      return <TableBlock key={index} block={block} />;
    case "math":
      return <MathBlock key={index} block={block} />;
    case "chart":
      return <ChartBlock key={index} block={block} />;
    case "diagram":
      return <DiagramBlock key={index} block={block} />;
    case "widget": {
      const widgetKey = r.widgetKeys.get(index);
      if (!widgetKey) return null; // unreachable once renderable (same rule), belt-and-braces
      return (
        <WidgetBlock
          key={widgetKey}
          block={block}
          conceptId={r.conceptId}
          conceptTitle={r.conceptTitle}
          widgetKey={widgetKey}
        />
      );
    }
    default:
      return (
        <Paragraph
          key={index}
          block={block}
          index={index}
          onTerm={r.onTerm}
          onHighlight={r.onHighlight}
          highlights={r.highlights.get(index) ?? []}
        />
      );
  }
}

function Paragraph({
  block,
  index,
  onTerm,
  onHighlight,
  highlights,
}: {
  block: Block;
  index: number;
  onTerm: (term: Term, rect: DOMRect) => void;
  onHighlight: (id: string, rect: DOMRect) => void;
  highlights: LocatedHighlight[];
}) {
  const text = block.text ?? "";
  // Streamed partials can carry half-built terms (a `gloss` before its `term`
  // arrives) — only keep terms with a real string to match on, or escapeRegex throws.
  const terms = (block.terms ?? []).filter(
    (t): t is Term => typeof t?.term === "string" && t.term.length > 0,
  );
  // data-prose + data-block-index let the selection handler find the owning block
  // and map a DOM selection back to this block's source text.
  return (
    <p className="mb-[18px]" data-prose data-block-index={index}>
      <RichText text={text} terms={terms} highlights={highlights} onTerm={onTerm} onHighlight={onHighlight} />
    </p>
  );
}

function Callout({ block }: { block: Block }) {
  return (
    <div className="my-[22px] flex gap-3 rounded-md border border-rule border-l-2 border-l-accent bg-surface px-4 py-3.5 font-sans text-[14.5px] leading-snug text-ink-2">
      {block.label && (
        <span className="mt-0.5 shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-accent">
          {block.label}
        </span>
      )}
      <span>
        <RichText text={block.text ?? ""} />
      </span>
    </div>
  );
}

function SectionHead({ block }: { block: Block }) {
  return (
    <div className="mb-3 mt-9 flex items-baseline justify-between border-b border-rule pb-2 font-sans">
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink">{block.label}</span>
      {block.hint && <span className="text-[11.5px] text-ink-3">{block.hint}</span>}
    </div>
  );
}

/** Top-right control to regenerate a lesson, with a two-step confirm so a misclick
 *  doesn't overwrite a good lesson. */
function RegenerateButton({ generating, onConfirm }: { generating: boolean; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);

  if (generating) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 font-sans text-[11.5px] text-ink-3">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        Regenerating…
      </span>
    );
  }
  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 font-sans text-[11.5px]">
        <span className="text-ink-3">Replace this lesson?</span>
        <button
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
          className="rounded-md bg-ink px-2 py-0.5 font-medium text-surface hover:bg-accent"
        >
          Regenerate
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded-md border border-rule px-2 py-0.5 text-ink-2 hover:border-rule-strong hover:text-ink"
        >
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button
      onClick={() => setConfirming(true)}
      title="Regenerate this lesson"
      className="flex shrink-0 items-center gap-1 rounded-md border border-transparent px-2 py-1 font-sans text-[11.5px] text-ink-3 hover:border-rule hover:bg-surface-2 hover:text-ink"
    >
      <span className="text-[13px] leading-none">↻</span>
      Regenerate
    </button>
  );
}

/** The active popover: either a clicked LLM term, or a learner text selection
 *  (fresh, or reopened from a saved highlight when `highlightId` is set). */
type PopState =
  | { kind: "term"; term: Term; rect: DOMRect }
  | {
      kind: "selection";
      rect: DOMRect;
      anchor: Anchor;
      text: string;
      highlightId: string | null;
      gloss: string | null;
      glossPending: boolean;
      forking: boolean;
      match: ConceptRow | null;
    };

type SelectionPop = Extract<PopState, { kind: "selection" }>;

/** The selection menu — the QuickActionPopover with actions for a free-text
 *  selection (or a reopened saved highlight). Owns the action handlers so the
 *  fork/define round-trips and their loading states stay contained. */
function SelectionMenu({
  sel,
  microCtx,
  onClose,
  onPatch,
  onFork,
  onAskTutor,
  saveHighlight,
  removeHighlight,
}: {
  sel: SelectionPop;
  microCtx: MicroContext;
  onClose: () => void;
  onPatch: (patch: Partial<SelectionPop>) => void;
  onFork: (title: string, summary?: string) => void;
  onAskTutor: (message: string) => void;
  /** persist (or update the gloss of) the highlight for this selection */
  saveHighlight: (gloss?: string) => Promise<string>;
  removeHighlight: (id: string) => void;
}) {
  const runDefine = async () => {
    onPatch({ glossPending: true });
    try {
      const gloss = await defineInline(sel.text, microCtx);
      await saveHighlight(gloss);
      onPatch({ gloss, glossPending: false });
    } catch {
      onPatch({ glossPending: false });
    }
  };
  const runFork = async () => {
    onPatch({ forking: true });
    try {
      const { title, summary } = await normalizeConcept(sel.text, microCtx);
      await saveHighlight(sel.gloss ?? undefined);
      onFork(title, summary);
    } finally {
      onClose();
    }
  };
  const runAsk = () => {
    void saveHighlight(sel.gloss ?? undefined);
    onAskTutor(`Explain this from the lesson: "${sel.text}"`);
    onClose();
  };
  const runGoTo = () => {
    void saveHighlight(sel.gloss ?? undefined);
    if (sel.match) onFork(sel.match.title, sel.gloss ?? undefined);
    onClose();
  };
  const runCopy = () => {
    void navigator.clipboard?.writeText(sel.text);
    onClose();
  };
  const runRemove = () => {
    if (sel.highlightId) removeHighlight(sel.highlightId);
    onClose();
  };

  const actions: PopoverAction[] = [];
  if (sel.match) {
    actions.push({ label: `Go to “${sel.match.title}”`, variant: "accent", onClick: runGoTo });
  } else {
    actions.push({ label: "Fork branch", variant: "accent", icon: <ForkIcon />, onClick: runFork, loading: sel.forking });
  }
  if (!sel.gloss && !sel.match) {
    actions.push({ label: "Define inline", onClick: runDefine, loading: sel.glossPending });
  }
  actions.push({ label: "Ask the tutor", onClick: runAsk });
  actions.push({ label: "Copy", onClick: runCopy });
  if (sel.highlightId) actions.push({ label: "Remove", onClick: runRemove });

  const gloss = sel.glossPending
    ? "Defining…"
    : (sel.gloss ?? (sel.match ? "Already a concept in this topic." : "Define inline for a one-line gloss."));

  return (
    <QuickActionPopover
      rect={sel.rect}
      title={sel.text}
      chip={sel.match ? "in your tree" : sel.highlightId ? "highlight" : "selection"}
      gloss={gloss}
      glossMuted={sel.glossPending || !sel.gloss}
      actions={actions}
      footer={
        sel.match
          ? "Links this mention to the existing concept."
          : sel.highlightId
            ? "Saved highlight · click it again anytime."
            : "Fork creates a deep-dive concept under this one."
      }
      onClose={onClose}
    />
  );
}

export function LessonPane({
  concept,
  concepts,
  path,
  topicTitle,
  briefSummary,
  referrer,
  onFork,
  onNavigate,
  onAskTutor,
  bottomInset,
}: {
  concept: ConceptRow;
  concepts: ConceptRow[];
  path: string[];
  topicTitle: string;
  /** the topic's intake brief summary — tailors lesson depth/emphasis */
  briefSummary?: string | null;
  /** the concept the learner navigated FROM — lets a lesson bridge from where they came */
  referrer?: string | null;
  onFork: (title: string, summary?: string) => void;
  /** navigate to an existing concept (a Link), without creating a new node */
  onNavigate: (conceptId: string) => void;
  /** open the chat drawer and auto-send a message (the selection "Ask the tutor") */
  onAskTutor: (message: string) => void;
  /** scroll room to reserve below the content so the chat drawer (which overlays
   *  the bottom of the lesson) never traps the last content out of reach. */
  bottomInset?: number;
}) {
  const siblings = concepts
    .filter((c) => c.parentId === concept.parentId && c.id !== concept.id)
    .map((c) => c.title);
  const children = concepts.filter((c) => c.parentId === concept.id).map((c) => c.title);
  // Every other concept in the topic, with a short stable handle, so the generator
  // can link to an existing lesson instead of re-forking it.
  const existingConcepts = concepts
    .filter((c) => c.id !== concept.id)
    .map((c, i) => ({ handle: `c${i + 1}`, conceptId: c.id, title: c.title, summary: c.summary }));

  // "Came from" concept: referrer (explicit navigation source) preferred, parent as fallback.
  const cameFromId = referrer ?? concept.parentId ?? null;
  const cameFrom = useLessonRow(cameFromId);

  const lessonCtx = {
    topicTitle,
    path,
    summary: concept.summary,
    siblings,
    children,
    existingConcepts,
    briefSummary,
    referrer,
  };
  const { lesson, loaded, partial, generating, error, generate, stop } = useConceptLesson(concept, lessonCtx);

  const highlightsQ = useHighlights(concept.id);
  const addHighlight = useAddHighlight(concept.id);
  const removeHighlight = useRemoveHighlight(concept.id);
  const microCtx: MicroContext = { topicTitle, path, conceptTitle: concept.title, briefSummary };

  // One popover at a time: an LLM term click, or a learner text selection.
  const [pop, setPop] = useState<PopState | null>(null);

  // While generating (first time OR regenerating), show the live stream; otherwise
  // the persisted lesson wins — so a regenerate visibly replaces the old one.
  const display = generating ? partial : (lesson ?? partial);
  const subtitle = display?.subtitle ?? null;
  const blocks = ((display?.blocks ?? []) as Block[]).filter(isRenderableBlock);
  // Idle = nothing generated and nothing in flight → show the Generate CTA. Gated on
  // `loaded` so it doesn't flash before a persisted lesson resolves when returning.
  const idle = loaded && !lesson && !generating && !error;

  // Ctrl+F find-in-lesson over the rendered article DOM. Recomputes when content
  // settles (blocks/generatedAt/generating) so an open search tracks streaming.
  const articleRef = useRef<HTMLDivElement>(null);
  const find = useLessonFind(
    articleRef,
    blocks.length > 0,
    `${blocks.length}:${lesson?.generatedAt ?? 0}:${generating}`,
  );

  // Split the lesson's closing recommendations into Links (existing concepts) and
  // Forks (net-new), re-resolved against the LIVE tree: a stored link whose target
  // was deleted is dropped, and a fork whose title now matches an existing concept
  // is promoted to a Link — so suggestions stay correct as the tree grows.
  const conceptById = new Map(concepts.map((c) => [c.id, c]));
  const related: RelatedItem[] = [];
  const relatedIds = new Set<string>();
  for (const s of (lesson?.suggestedLessons as SuggestedLesson[] | undefined) ?? []) {
    const row = conceptById.get(s.conceptId);
    if (!row || relatedIds.has(row.id)) continue;
    relatedIds.add(row.id);
    related.push({ conceptId: row.id, title: row.title, reason: s.reason, viaFork: false });
  }
  const forks: SuggestedFork[] = [];
  for (const f of (lesson?.suggestedForks as SuggestedFork[] | undefined) ?? []) {
    const match = findExistingConcept(f.title, concepts, concept.id);
    if (match) {
      if (!relatedIds.has(match.id)) {
        relatedIds.add(match.id);
        related.push({ conceptId: match.id, title: match.title, reason: f.reason, viaFork: true });
      }
    } else {
      forks.push(f);
    }
  }

  // Place each saved highlight in the first paragraph block whose source text its
  // anchor resolves in (stable assignment, so a phrase repeated across blocks isn't
  // double-rendered). Skipped while generating — block text isn't settled yet.
  const placedHighlights = new Map<number, LocatedHighlight[]>();
  if (!generating) {
    const placed = new Set<string>();
    blocks.forEach((b, i) => {
      if (b.kind !== "paragraph") return;
      const text = b.text ?? "";
      const arr: LocatedHighlight[] = [];
      for (const h of highlightsQ.data ?? []) {
        if (placed.has(h.id)) continue;
        const loc = locateAnchor(text, { exact: h.exact, prefix: h.prefix, suffix: h.suffix });
        if (loc) {
          arr.push({ id: h.id, gloss: h.gloss, start: loc.start, end: loc.end });
          placed.add(h.id);
        }
      }
      if (arr.length) placedHighlights.set(i, arr);
    });
  }

  // Capture a prose selection → open the selection menu. Only fires for a non-empty
  // selection that sits inside a single paragraph and whose text we can re-find in
  // that block's source (a selection crossing inline math won't, and is ignored).
  const onProseMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const exact = sel.toString().trim();
    if (exact.length < 2) return;
    const range = sel.getRangeAt(0);
    const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as HTMLElement | null;
    const endEl = (range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement) as HTMLElement | null;
    const para = startEl?.closest("[data-prose]") as HTMLElement | null;
    if (!para || para !== endEl?.closest("[data-prose]")) return;
    const blockIndex = Number(para.dataset.blockIndex);
    const blockText = blocks[blockIndex]?.text ?? "";
    if (!blockText) return;
    // Rendered offset of the selection start within the paragraph — a hint that
    // disambiguates which occurrence of `exact` in the source the learner picked.
    const pre = document.createRange();
    pre.selectNodeContents(para);
    pre.setEnd(range.startContainer, range.startOffset);
    const src = nearestOccurrence(blockText, exact, pre.toString().length);
    if (src === null) return;
    setPop({
      kind: "selection",
      rect: range.getBoundingClientRect(),
      anchor: buildAnchor(blockText, src, src + exact.length),
      text: exact,
      highlightId: null,
      gloss: null,
      glossPending: false,
      forking: false,
      match: findExistingConcept(exact, concepts, concept.id),
    });
  };

  // Reopen the menu for an already-saved highlight (clicked in the prose).
  const onHighlightClick = (id: string, rect: DOMRect) => {
    const h = (highlightsQ.data ?? []).find((x) => x.id === id);
    if (!h) return;
    setPop({
      kind: "selection",
      rect,
      anchor: { exact: h.exact, prefix: h.prefix, suffix: h.suffix },
      text: h.exact,
      highlightId: h.id,
      gloss: h.gloss,
      glossPending: false,
      forking: false,
      match: findExistingConcept(h.exact, concepts, concept.id),
    });
  };

  const blockRender: BlockRender = {
    onTerm: (term, rect) => setPop({ kind: "term", term, rect }),
    onHighlight: onHighlightClick,
    highlights: placedHighlights,
    widgetKeys: widgetKeysFor(blocks),
    conceptId: concept.id,
    conceptTitle: concept.title,
  };

  return (
    <div ref={articleRef} className="mx-auto max-w-[720px] px-12 pt-10" style={{ paddingBottom: bottomInset ?? 96 }}>
      {find.isOpen && <FindBar find={find} />}
      <div data-find-ignore className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center overflow-hidden whitespace-nowrap font-mono text-[11.5px] text-ink-3">
          {path.map((b, i) => (
            <span key={i}>
              {i > 0 && <span className="px-1 text-ink-4">/</span>}
              <span className={i === path.length - 1 ? "text-ink" : ""}>{b}</span>
            </span>
          ))}
        </div>
        {lesson && <RegenerateButton generating={generating} onConfirm={generate} />}
      </div>

      <h1 className="font-serif text-4xl font-normal leading-tight tracking-tight text-ink">{concept.title}</h1>
      {subtitle && <p className="mt-2 font-serif text-lg italic text-ink-2">{subtitle}</p>}

      {cameFromId && cameFrom.data?.digest?.recap && (
        <div className="mt-7">
          <PreviouslyBand
            fromTitle={cameFrom.data.title}
            recap={cameFrom.data.digest.recap}
            onGo={() => onNavigate(cameFromId)}
          />
        </div>
      )}

      <SelfHealBanner
        stale={!!lesson?.stale}
        revised={(lesson?.version ?? 1) > 1}
        canRevert={!!lesson?.prevSnapshot}
        onRefresh={() => void refreshLesson(concept, lessonCtx)}
        onDismiss={() => void dismissStale(concept.id)}
        onRevert={() => void revertLesson(concept.id)}
      />

      {idle && (
        <>
          {concept.summary && (
            <p className="mt-2 font-serif text-lg italic text-ink-2">{concept.summary}</p>
          )}
          <div className="mt-8">
            <button
              onClick={generate}
              className="rounded-md bg-ink px-4 py-2 font-sans text-[13px] font-medium text-surface hover:bg-accent"
            >
              Generate lesson
            </button>
            <p className="mt-2.5 font-sans text-[11.5px] text-ink-3">
              Writes this lesson with AI — it streams in as it's created.
            </p>
          </div>
        </>
      )}

      {generating && blocks.length === 0 && (
        <div data-find-ignore className="mt-8 flex items-center gap-2 text-sm text-ink-3">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Generating this lesson…
          <button
            onClick={stop}
            className="ml-1 rounded border border-rule px-1.5 py-0.5 text-[11px] text-ink-3 hover:border-rule-strong hover:text-ink"
          >
            Stop
          </button>
        </div>
      )}
      {error && !generating && (
        <div data-find-ignore className="mt-8 rounded-md border border-dashed border-rule-strong bg-surface p-4 text-sm text-ink-2">
          <p className="text-red-600">Couldn't generate this lesson — {error}</p>
          <button onClick={generate} className="mt-2 rounded-md bg-ink px-3 py-1 text-xs font-medium text-surface hover:bg-accent">
            Retry
          </button>
        </div>
      )}

      {blocks.length > 0 && (
        <ErrorBoundary
          resetKey={`${generating}:${blocks.length}:${lesson?.generatedAt ?? 0}`}
          fallback={
            <div className="mt-8 rounded-md border border-dashed border-rule-strong bg-surface p-4 text-sm">
              <p className="text-red-600">This lesson couldn't be displayed — the generated content was malformed.</p>
              <p className="mt-1 text-ink-3">Use ↻ Regenerate above to recreate it.</p>
            </div>
          }
        >
          <div className="mt-7 font-serif text-[16.5px] leading-[1.65] text-ink" onMouseUp={onProseMouseUp}>
            {blocks.map((b, i) => renderBlock(b, i, blockRender))}
            {generating && (
              <div data-find-ignore className="mt-2 flex items-center gap-2 font-sans text-xs text-ink-3">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                streaming…
                <button
                  onClick={stop}
                  className="rounded border border-rule px-1.5 py-0.5 text-[11px] text-ink-3 hover:border-rule-strong hover:text-ink"
                >
                  Stop
                </button>
              </div>
            )}
            {!generating && (
              <div data-find-ignore>
                <NextSteps related={related} forks={forks} onFork={onFork} onNavigate={onNavigate} />
              </div>
            )}
          </div>
        </ErrorBoundary>
      )}

      {pop?.kind === "term" && (
        <TermPopover
          term={pop.term}
          rect={pop.rect}
          onClose={() => setPop(null)}
          onFork={() => {
            onFork(pop.term.term, pop.term.gloss);
            setPop(null);
          }}
        />
      )}
      {pop?.kind === "selection" && (
        <SelectionMenu
          sel={pop}
          microCtx={microCtx}
          onClose={() => setPop(null)}
          onPatch={(patch) => setPop((p) => (p && p.kind === "selection" ? { ...p, ...patch } : p))}
          onFork={onFork}
          onAskTutor={onAskTutor}
          saveHighlight={(gloss) =>
            addHighlight.mutateAsync({
              exact: pop.anchor.exact,
              prefix: pop.anchor.prefix,
              suffix: pop.anchor.suffix,
              gloss,
            })
          }
          removeHighlight={(id) => removeHighlight.mutate(id)}
        />
      )}
    </div>
  );
}
