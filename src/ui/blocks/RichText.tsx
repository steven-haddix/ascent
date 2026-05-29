import { Fragment } from "react";
import type { Term } from "../../core/types";
import { InlineMath } from "./MathBlock";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MATH_INLINE_RE = /\$(\S(?:[^$\n]*?\S)?)\$/g;

/** Split text into inline-math ($...) vs plain-text segments. The pattern
 *  requires a non-space just inside the delimiters, so prose like "$5 and $10" is
 *  not mistaken for math. */
export function splitMathSegments(text: string): { math: boolean; value: string }[] {
  const out: { math: boolean; value: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(MATH_INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ math: false, value: text.slice(last, idx) });
    out.push({ math: true, value: m[1] });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ math: false, value: text.slice(last) });
  return out.length ? out : [{ math: false, value: text }];
}

/** Render a plain-text run, wrapping any forkable terms it contains. */
function renderTextWithTerms(
  text: string,
  terms: Term[],
  onTerm: ((t: Term, r: DOMRect) => void) | undefined,
  keyPrefix: string,
) {
  if (terms.length === 0 || !onTerm) return text;
  const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
  const re = new RegExp(`(${sorted.map((t) => escapeRegex(t.term)).join("|")})`, "gi");
  return text.split(re).map((part, i) => {
    const term = terms.find((t) => t.term.toLowerCase() === part.toLowerCase());
    return term ? (
      <span
        key={`${keyPrefix}-${i}`}
        className="cursor-pointer rounded-[3px] border-b border-dotted border-accent bg-accent/10 px-0.5 hover:bg-accent/20"
        onClick={(e) => onTerm(term, (e.currentTarget as HTMLElement).getBoundingClientRect())}
      >
        {part}
      </span>
    ) : (
      <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>
    );
  });
}

/** Inline rich text: renders `$...$` spans through KaTeX and wraps any forkable
 *  terms. Used in prose paragraphs and table cells alike so math renders
 *  consistently wherever lesson text appears. */
export function RichText({
  text,
  terms = [],
  onTerm,
  keyPrefix = "rt",
}: {
  text: string;
  terms?: Term[];
  onTerm?: (t: Term, r: DOMRect) => void;
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
            {renderTextWithTerms(seg.value, terms, onTerm, `${keyPrefix}-t${i}`)}
          </Fragment>
        ),
      )}
    </>
  );
}
