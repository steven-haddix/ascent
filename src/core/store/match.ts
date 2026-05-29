// Duplicate detection for concept titles — the deterministic safety net behind
// the model's semantic Fork-vs-Link decision. Pure functions over an in-memory
// concept list: no I/O, no React, trivially testable.
//
// Scope is deliberately conservative: exact normalized equality only. The LLM
// does the paraphrase-tolerant matching (it's given the existing concepts); this
// guard only guarantees we never create a near-identical duplicate on stale UI or
// as the tree grows. Linking to the WRONG concept is worse than an occasional
// dupe, so we do not fuzzy-match here (trigram tightening is a future option).
import type { ConceptRow } from "./repositories";

/** Case-, punctuation-, and whitespace-insensitive key for duplicate detection. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Find an existing concept whose title duplicates `title`, excluding `excludeId`.
 *  Returns the matched concept, or null when the title is genuinely net-new. */
export function findExistingConcept(
  title: string,
  concepts: ConceptRow[],
  excludeId?: string,
): ConceptRow | null {
  const key = normalizeTitle(title);
  if (!key) return null;
  return (
    concepts.find((c) => c.id !== excludeId && normalizeTitle(c.title) === key) ?? null
  );
}
