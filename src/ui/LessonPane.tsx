import { useState } from "react";
import type { ConceptRow } from "../core/store/repositories";
import type { Block, SuggestedFork, SuggestedLesson, Term } from "../core/types";
import { useConceptLesson } from "../core/store/hooks";
import { findExistingConcept } from "../core/store/match";
import { TermPopover } from "./TermPopover";
import { ErrorBoundary } from "./ErrorBoundary";
import { CodeBlock } from "./code/CodeBlock";
import { TableBlock } from "./blocks/TableBlock";
import { MathBlock } from "./blocks/MathBlock";
import { RichText } from "./blocks/RichText";
import { ChartBlock } from "./blocks/ChartBlock";
import { DiagramBlock } from "./blocks/DiagramBlock";

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

/** Render one block by kind. Visual kinds are wired in per slice; unknown or
 *  not-yet-handled kinds fall back to a paragraph. */
function renderBlock(block: Block, key: number, onTerm: (t: Term, r: DOMRect) => void) {
  switch (block.kind) {
    case "section":
      return <SectionHead key={key} block={block} />;
    case "callout":
      return <Callout key={key} block={block} />;
    case "code":
      return <CodeBlock key={key} block={block} />;
    case "table":
      return <TableBlock key={key} block={block} />;
    case "math":
      return <MathBlock key={key} block={block} />;
    case "chart":
      return <ChartBlock key={key} block={block} />;
    case "diagram":
      return <DiagramBlock key={key} block={block} />;
    default:
      return <Paragraph key={key} block={block} onTerm={onTerm} />;
  }
}

function Paragraph({ block, onTerm }: { block: Block; onTerm: (term: Term, rect: DOMRect) => void }) {
  const text = block.text ?? "";
  // Streamed partials can carry half-built terms (a `gloss` before its `term`
  // arrives) — only keep terms with a real string to match on, or escapeRegex throws.
  const terms = (block.terms ?? []).filter(
    (t): t is Term => typeof t?.term === "string" && t.term.length > 0,
  );
  return (
    <p className="mb-[18px]">
      <RichText text={text} terms={terms} onTerm={onTerm} />
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
      <span>{block.text}</span>
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

/** A row at the lesson foot: a Link to an existing concept, or a Fork to a new one.
 *  Same shape, different action label + handler. */
function SuggestionRow({
  title,
  reason,
  action,
  onClick,
}: {
  title: string;
  reason: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-rule bg-surface px-3 py-2.5 text-left hover:border-accent hover:bg-surface-2"
    >
      <span>
        <span className="block text-[13px] font-medium text-ink">{title}</span>
        {reason && <span className="mt-0.5 block text-[12px] text-ink-3">{reason}</span>}
      </span>
      <span className="shrink-0 font-mono text-[11.5px] text-ink-3">{action}</span>
    </button>
  );
}

function SuggestionSection({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="mt-9 font-sans">
      <div className="mb-3 flex items-baseline justify-between border-b border-rule pb-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink">{label}</span>
        <span className="text-[11.5px] text-ink-3">{hint}</span>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

/** A link to a concept that already exists in the tree. `viaFork` rows are forks
 *  that turned out to match an existing concept at render time — they route through
 *  `onFork` so the dedup guard (one site) navigates AND records the edge; plain
 *  links navigate directly (their edge was created eagerly at generation). */
export interface RelatedItem {
  conceptId: string;
  title: string;
  reason: string;
  viaFork: boolean;
}

function NextSteps({
  related,
  forks,
  onFork,
  onNavigate,
}: {
  related: RelatedItem[];
  forks: SuggestedFork[];
  onFork: (title: string, summary?: string) => void;
  onNavigate: (conceptId: string) => void;
}) {
  if (!related.length && !forks.length) return null;
  return (
    <>
      {related.length > 0 && (
        <SuggestionSection label="Related in your tree" hint="Already here — go revisit">
          {related.map((r) => (
            <SuggestionRow
              key={r.conceptId}
              title={r.title}
              reason={r.reason}
              action="Go to →"
              onClick={() => (r.viaFork ? onFork(r.title, r.reason) : onNavigate(r.conceptId))}
            />
          ))}
        </SuggestionSection>
      )}
      {forks.length > 0 && (
        <SuggestionSection label="Branches to explore" hint="New — fork into your tree">
          {forks.map((f, i) => (
            <SuggestionRow key={i} title={f.title} reason={f.reason} action="Fork →" onClick={() => onFork(f.title, f.reason)} />
          ))}
        </SuggestionSection>
      )}
    </>
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

export function LessonPane({
  concept,
  concepts,
  path,
  topicTitle,
  briefSummary,
  onFork,
  onNavigate,
  bottomInset,
}: {
  concept: ConceptRow;
  concepts: ConceptRow[];
  path: string[];
  topicTitle: string;
  /** the topic's intake brief summary — tailors lesson depth/emphasis */
  briefSummary?: string | null;
  onFork: (title: string, summary?: string) => void;
  /** navigate to an existing concept (a Link), without creating a new node */
  onNavigate: (conceptId: string) => void;
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

  const { lesson, partial, generating, error, retry, stop } = useConceptLesson(concept, {
    topicTitle,
    path,
    summary: concept.summary,
    siblings,
    children,
    existingConcepts,
    briefSummary,
  });
  const [pop, setPop] = useState<{ term: Term; rect: DOMRect } | null>(null);

  // While generating (first time OR regenerating), show the live stream; otherwise
  // the persisted lesson wins — so a regenerate visibly replaces the old one.
  const display = generating ? partial : (lesson ?? partial);
  const subtitle = display?.subtitle ?? null;
  const blocks = ((display?.blocks ?? []) as Block[]).filter(isRenderableBlock);

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

  return (
    <div className="mx-auto max-w-[720px] px-12 pt-10" style={{ paddingBottom: bottomInset ?? 96 }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center overflow-hidden whitespace-nowrap font-mono text-[11.5px] text-ink-3">
          {path.map((b, i) => (
            <span key={i}>
              {i > 0 && <span className="px-1 text-ink-4">/</span>}
              <span className={i === path.length - 1 ? "text-ink" : ""}>{b}</span>
            </span>
          ))}
        </div>
        {lesson && <RegenerateButton generating={generating} onConfirm={retry} />}
      </div>

      <h1 className="font-serif text-4xl font-normal leading-tight tracking-tight text-ink">{concept.title}</h1>
      {subtitle && <p className="mt-2 font-serif text-lg italic text-ink-2">{subtitle}</p>}

      {generating && blocks.length === 0 && (
        <div className="mt-8 flex items-center gap-2 text-sm text-ink-3">
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
        <div className="mt-8 rounded-md border border-dashed border-rule-strong bg-surface p-4 text-sm text-ink-2">
          <p className="text-red-600">Couldn't generate this lesson — {error}</p>
          <button onClick={retry} className="mt-2 rounded-md bg-ink px-3 py-1 text-xs font-medium text-surface hover:bg-accent">
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
          <div className="mt-7 font-serif text-[16.5px] leading-[1.65] text-ink">
            {blocks.map((b, i) => renderBlock(b, i, (t, r) => setPop({ term: t, rect: r })))}
            {generating && (
              <div className="mt-2 flex items-center gap-2 font-sans text-xs text-ink-3">
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
              <NextSteps related={related} forks={forks} onFork={onFork} onNavigate={onNavigate} />
            )}
          </div>
        </ErrorBoundary>
      )}

      {pop && (
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
    </div>
  );
}
