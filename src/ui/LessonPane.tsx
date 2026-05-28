import { Fragment, useState } from "react";
import type { ConceptRow } from "../core/store/repositories";
import type { Block, SuggestedBranch, Term } from "../core/types";
import { useConceptLesson } from "../core/store/hooks";
import { TermPopover } from "./TermPopover";
import { ErrorBoundary } from "./ErrorBoundary";
import { CodeBlock } from "./code/CodeBlock";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Paragraph({ block, onTerm }: { block: Block; onTerm: (term: Term, rect: DOMRect) => void }) {
  const text = block.text ?? "";
  // Streamed partials can carry half-built terms (a `gloss` before its `term`
  // arrives) — only keep terms with a real string to match on, or escapeRegex throws.
  const terms = (block.terms ?? []).filter(
    (t): t is Term => typeof t?.term === "string" && t.term.length > 0,
  );
  if (terms.length === 0) return <p className="mb-[18px]">{text}</p>;

  const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
  const re = new RegExp(`(${sorted.map((t) => escapeRegex(t.term)).join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <p className="mb-[18px]">
      {parts.map((part, i) => {
        const term = terms.find((t) => t.term.toLowerCase() === part.toLowerCase());
        return term ? (
          <span
            key={i}
            className="cursor-pointer rounded-[3px] border-b border-dotted border-accent bg-accent/10 px-0.5 hover:bg-accent/20"
            onClick={(e) => onTerm(term, (e.currentTarget as HTMLElement).getBoundingClientRect())}
          >
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
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

function SuggestedBranches({
  branches,
  onFork,
}: {
  branches: SuggestedBranch[];
  onFork: (title: string, summary?: string) => void;
}) {
  if (!branches.length) return null;
  return (
    <div className="mt-9 font-sans">
      <div className="mb-3 flex items-baseline justify-between border-b border-rule pb-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink">Branches to explore</span>
        <span className="text-[11.5px] text-ink-3">Click to fork into your tree</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {branches.map((b, i) => (
          <button
            key={i}
            onClick={() => onFork(b.title, b.reason)}
            className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-rule bg-surface px-3 py-2.5 text-left hover:border-accent hover:bg-surface-2"
          >
            <span>
              <span className="block text-[13px] font-medium text-ink">{b.title}</span>
              <span className="mt-0.5 block text-[12px] text-ink-3">{b.reason}</span>
            </span>
            <span className="font-mono text-[11.5px] text-ink-3">Fork →</span>
          </button>
        ))}
      </div>
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

export function LessonPane({
  concept,
  concepts,
  path,
  topicTitle,
  onFork,
}: {
  concept: ConceptRow;
  concepts: ConceptRow[];
  path: string[];
  topicTitle: string;
  onFork: (title: string, summary?: string) => void;
}) {
  const siblings = concepts
    .filter((c) => c.parentId === concept.parentId && c.id !== concept.id)
    .map((c) => c.title);
  const children = concepts.filter((c) => c.parentId === concept.id).map((c) => c.title);

  const { lesson, partial, generating, error, retry } = useConceptLesson(concept, {
    topicTitle,
    path,
    summary: concept.summary,
    siblings,
    children,
  });
  const [pop, setPop] = useState<{ term: Term; rect: DOMRect } | null>(null);

  // While generating (first time OR regenerating), show the live stream; otherwise
  // the persisted lesson wins — so a regenerate visibly replaces the old one.
  const display = generating ? partial : (lesson ?? partial);
  const subtitle = display?.subtitle ?? null;
  const blocks = ((display?.blocks ?? []) as Block[]).filter((b) =>
    b.kind ? (b.kind === "section" ? !!b.label?.trim() : !!b.text?.trim()) : false,
  );
  const branches = (lesson?.suggestedBranches as SuggestedBranch[] | undefined) ?? [];

  return (
    <div className="mx-auto max-w-[720px] px-12 pb-24 pt-10">
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
            {blocks.map((b, i) =>
              b.kind === "section" ? (
                <SectionHead key={i} block={b} />
              ) : b.kind === "callout" ? (
                <Callout key={i} block={b} />
              ) : b.kind === "code" ? (
                <CodeBlock key={i} block={b} />
              ) : (
                <Paragraph key={i} block={b} onTerm={(t, r) => setPop({ term: t, rect: r })} />
              ),
            )}
            {generating && (
              <div className="mt-2 flex items-center gap-2 font-sans text-xs text-ink-3">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                streaming…
              </div>
            )}
            {!generating && <SuggestedBranches branches={branches} onFork={onFork} />}
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
