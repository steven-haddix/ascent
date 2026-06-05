// Pure match-finding for the lesson find bar. No DOM — the DOM walk in
// useLessonFind concatenates visible text nodes into one string and uses these
// helpers to locate hits, so the only real logic lives here and stays testable.

/** A located match as a half-open [start, end) range in the source string. */
export interface MatchRange {
  start: number;
  end: number;
}

/** Find every non-overlapping, case-insensitive occurrence of `query` in `text`.
 *  Scanning advances past each hit so adjacent/repeated matches don't overlap.
 *  Returns [] for an empty/whitespace-only query. */
export function locateMatches(text: string, query: string): MatchRange[] {
  if (!query) return [];
  const needle = query.toLowerCase();
  if (!needle.trim()) return [];
  const hay = text.toLowerCase();
  const out: MatchRange[] = [];
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) break;
    out.push({ start: idx, end: idx + needle.length });
    from = idx + needle.length; // non-overlapping
  }
  return out;
}
