// Quote + context anchoring for learner highlights (a TextQuoteSelector). Pure
// functions over plain strings — no DOM, no React, trivially testable.
//
// A highlight stores the selected text (`exact`) plus a few characters of the
// surrounding block text (`prefix`/`suffix`). To re-render it we search the block
// text for `exact`; when the same phrase occurs more than once, the surrounding
// context disambiguates which occurrence the learner actually marked. This
// survives blocks shifting (e.g. the chat appending a code block) without storing
// brittle character offsets.

export interface Anchor {
  exact: string;
  prefix: string;
  suffix: string;
}

/** How many characters of surrounding context to capture on each side. */
export const CONTEXT_LEN = 32;

/** Build an anchor for `text[start, end)` with up to `ctxLen` chars of context. */
export function buildAnchor(text: string, start: number, end: number, ctxLen = CONTEXT_LEN): Anchor {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - ctxLen), start),
    suffix: text.slice(end, end + ctxLen),
  };
}

/** All start indices where `needle` occurs in `text` (overlapping allowed). */
export function occurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = text.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = text.indexOf(needle, i + 1);
  }
  return out;
}

/** The occurrence of `needle` in `text` nearest to `approx` (a hint offset, e.g.
 *  the selection's rendered position). Used at save time to pick which occurrence
 *  the learner selected. Null when `needle` is absent. */
export function nearestOccurrence(text: string, needle: string, approx: number): number | null {
  const idxs = occurrences(text, needle);
  if (!idxs.length) return null;
  let best = idxs[0];
  let bestDist = Math.abs(idxs[0] - approx);
  for (const idx of idxs) {
    const d = Math.abs(idx - approx);
    if (d < bestDist) {
      bestDist = d;
      best = idx;
    }
  }
  return best;
}

function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Re-locate an anchor in `text`. Returns the matched range, or null when `exact`
 *  no longer appears (the highlight is then silently skipped, never deleted). When
 *  `exact` occurs multiple times, the occurrence whose surrounding text best
 *  matches the stored prefix/suffix wins; ties resolve to the earliest. */
export function locateAnchor(text: string, anchor: Anchor): { start: number; end: number } | null {
  const idxs = occurrences(text, anchor.exact);
  if (!idxs.length) return null;
  if (idxs.length === 1) return { start: idxs[0], end: idxs[0] + anchor.exact.length };

  let best = idxs[0];
  let bestScore = -1;
  for (const idx of idxs) {
    const before = text.slice(Math.max(0, idx - anchor.prefix.length), idx);
    const after = text.slice(idx + anchor.exact.length, idx + anchor.exact.length + anchor.suffix.length);
    const score = commonSuffixLen(before, anchor.prefix) + commonPrefixLen(after, anchor.suffix);
    if (score > bestScore) {
      bestScore = score;
      best = idx;
    }
  }
  return { start: best, end: best + anchor.exact.length };
}
