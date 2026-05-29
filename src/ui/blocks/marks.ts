// Merge LLM forkable terms and learner highlights into a single ordered set of
// render pieces over one text run. Pure — no DOM, no React — so the overlap logic
// is testable away from the renderer.
//
// Terms are matched by string (the model tags them verbatim); highlights arrive as
// already-located ranges (see core/highlights/anchor). Where a term and a highlight
// overlap, we split at the boundary so each character belongs to at most one term
// and at most one highlight; a piece can carry both.
import type { Term } from "../../core/types";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A located highlight within a text run (offsets are local to that run). */
export interface LocatedHighlight {
  id: string;
  gloss: string | null;
  start: number;
  end: number;
}

export interface TermHit {
  start: number;
  end: number;
  term: Term;
}

/** A contiguous run of text with optional term/highlight attribution. */
export interface Piece {
  text: string;
  term?: Term;
  highlight?: LocatedHighlight;
}

/** Find every term occurrence in `text` as a [start, end) hit. Longer terms win
 *  when terms are substrings of one another; overlapping later hits are dropped. */
export function findTermHits(text: string, terms: Term[]): TermHit[] {
  const valid = terms.filter((t) => typeof t?.term === "string" && t.term.length > 0);
  if (!valid.length) return [];
  const byLen = [...valid].sort((a, b) => b.term.length - a.term.length);
  const re = new RegExp(`(${byLen.map((t) => escapeRegex(t.term)).join("|")})`, "gi");
  const hits: TermHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const matched = m[0];
    if (matched.length === 0) {
      re.lastIndex++;
      continue;
    }
    const term = valid.find((t) => t.term.toLowerCase() === matched.toLowerCase());
    if (term) hits.push({ start: m.index, end: m.index + matched.length, term });
  }
  return hits;
}

/** Split `text` into ordered, non-overlapping pieces carrying the term and/or
 *  highlight that covers each. Boundaries are the union of all hit edges. */
export function mergeMarks(text: string, termHits: TermHit[], highlights: LocatedHighlight[]): Piece[] {
  const clamp = (n: number) => Math.max(0, Math.min(text.length, n));
  const bounds = new Set<number>([0, text.length]);
  for (const h of termHits) {
    bounds.add(clamp(h.start));
    bounds.add(clamp(h.end));
  }
  for (const h of highlights) {
    bounds.add(clamp(h.start));
    bounds.add(clamp(h.end));
  }
  const points = [...bounds].sort((a, b) => a - b);
  const pieces: Piece[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i];
    const e = points[i + 1];
    if (e <= s) continue;
    const term = termHits.find((h) => h.start <= s && h.end >= e)?.term;
    const highlight = highlights.find((h) => h.start <= s && h.end >= e);
    pieces.push({ text: text.slice(s, e), term, highlight });
  }
  return pieces;
}
