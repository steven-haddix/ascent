import { Fragment } from "react";
import type { Term } from "../../core/types";
import { InlineMath } from "./MathBlock";
import { findTermHits, mergeMarks, type LocatedHighlight } from "./marks";

const MATH_INLINE_RE = /\$(\S(?:[^$\n]*?\S)?)\$/g;

/** Split text into inline-math ($...) vs plain-text segments, each tagged with its
 *  `start` offset in the original text so highlight ranges (anchored in block-text
 *  space) can be mapped into a segment's local coordinates. The pattern requires a
 *  non-space just inside the delimiters, so prose like "$5 and $10" is not mistaken
 *  for math. */
export function splitMathSegments(text: string): { math: boolean; value: string; start: number }[] {
  const out: { math: boolean; value: string; start: number }[] = [];
  let last = 0;
  for (const m of text.matchAll(MATH_INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ math: false, value: text.slice(last, idx), start: last });
    out.push({ math: true, value: m[1], start: idx });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ math: false, value: text.slice(last), start: last });
  return out.length ? out : [{ math: false, value: text, start: 0 }];
}

/** Render a plain-text run, wrapping forkable terms and learner highlights. Offsets
 *  in `highlights` are relative to the run (already mapped from block-text space). */
function renderRun(
  text: string,
  terms: Term[],
  highlights: LocatedHighlight[],
  onTerm: ((t: Term, r: DOMRect) => void) | undefined,
  onHighlight: ((id: string, r: DOMRect) => void) | undefined,
  keyPrefix: string,
) {
  const termHits = onTerm ? findTermHits(text, terms) : [];
  const hl = onHighlight ? highlights : [];
  if (!termHits.length && !hl.length) return text;

  return mergeMarks(text, termHits, hl).map((piece, i) => {
    const key = `${keyPrefix}-${i}`;
    if (piece.highlight && onHighlight) {
      const id = piece.highlight.id;
      return (
        <span
          key={key}
          className="cursor-pointer rounded-[3px] border-b border-dotted border-highlight/80 bg-highlight/20 px-0.5 hover:bg-highlight/30"
          onClick={(e) => onHighlight(id, (e.currentTarget as HTMLElement).getBoundingClientRect())}
        >
          {piece.text}
        </span>
      );
    }
    if (piece.term && onTerm) {
      const term = piece.term;
      return (
        <span
          key={key}
          className="cursor-pointer rounded-[3px] border-b border-dotted border-accent bg-accent/10 px-0.5 hover:bg-accent/20"
          onClick={(e) => onTerm(term, (e.currentTarget as HTMLElement).getBoundingClientRect())}
        >
          {piece.text}
        </span>
      );
    }
    return <Fragment key={key}>{piece.text}</Fragment>;
  });
}

/** Inline rich text: renders `$...$` spans through KaTeX and wraps forkable terms
 *  and learner highlights. Used in prose paragraphs and table cells alike so math
 *  renders consistently wherever lesson text appears. */
export function RichText({
  text,
  terms = [],
  highlights = [],
  onTerm,
  onHighlight,
  keyPrefix = "rt",
}: {
  text: string;
  terms?: Term[];
  /** located highlight ranges in `text` (block-text) coordinates */
  highlights?: LocatedHighlight[];
  onTerm?: (t: Term, r: DOMRect) => void;
  onHighlight?: (id: string, r: DOMRect) => void;
  keyPrefix?: string;
}) {
  const segments = splitMathSegments(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.math ? (
          <InlineMath key={`${keyPrefix}-m-${i}`} tex={seg.value} />
        ) : (
          <Fragment key={`${keyPrefix}-t-${i}`}>
            {renderRun(
              seg.value,
              terms,
              highlights
                .filter((h) => h.end > seg.start && h.start < seg.start + seg.value.length)
                .map((h) => ({ ...h, start: h.start - seg.start, end: h.end - seg.start })),
              onTerm,
              onHighlight,
              `${keyPrefix}-t${i}`,
            )}
          </Fragment>
        ),
      )}
    </>
  );
}
