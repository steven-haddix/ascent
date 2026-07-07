// Pure chunker (no DB/AI) — turns extracted sections into retrieval-ready passages.
// Targets ~800 tokens (≈3200 chars): big enough to carry an idea, small enough that
// 3-4 chunks fit a bounded prompt block. Splits respect section boundaries (a chunk
// never spans two sections, so its locator stays truthful); long sections split on
// sentence boundaries with a small tail-overlap so a thought cut mid-argument still
// retrieves; tiny neighbor sections within the same locator run are merged.
import type { Chunk, ExtractedSection } from "./types";

export const CHUNK_TARGET_CHARS = 3200;
export const CHUNK_MIN_CHARS = 400;
export const CHUNK_OVERLAP_CHARS = 300;

function normalizedSectionText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Split text into sentence-ish pieces (fallback: hard slice for wall-of-text). */
function sentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]?\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= CHUNK_TARGET_CHARS) {
      out.push(p);
      continue;
    }
    for (let i = 0; i < p.length; i += CHUNK_TARGET_CHARS) out.push(p.slice(i, i + CHUNK_TARGET_CHARS));
  }
  return out;
}

/** Chunk one section's text, carrying its locator; overlap ties adjacent chunks. */
function chunkSection(section: ExtractedSection): { locator: string | null; text: string }[] {
  const text = normalizedSectionText(section.text);
  if (!text) return [];
  if (text.length <= CHUNK_TARGET_CHARS) return [{ locator: section.locator, text }];

  const out: { locator: string | null; text: string }[] = [];
  let buf = "";
  for (const s of sentences(text)) {
    if (buf.length + s.length > CHUNK_TARGET_CHARS && buf) {
      out.push({ locator: section.locator, text: buf.trim() });
      const priorSentences = sentences(buf.trim());
      let overlap = "";
      for (let i = priorSentences.length - 1; i >= 0; i--) {
        const candidate = priorSentences[i] + overlap;
        if (candidate.length > CHUNK_OVERLAP_CHARS && overlap) break;
        overlap = candidate;
      }
      // A pathological sentence can exceed the overlap target; start at a word
      // boundary rather than duplicating a mid-word character slice.
      if (overlap.length > CHUNK_OVERLAP_CHARS * 2) {
        const tail = overlap.slice(-CHUNK_OVERLAP_CHARS);
        const boundary = tail.search(/\s/);
        overlap = boundary >= 0 ? tail.slice(boundary + 1) : tail;
      }
      buf = overlap + s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push({ locator: section.locator, text: buf.trim() });
  return out;
}

/** Chunk a whole extracted document. Merges runt sections forward so a heading
 *  with one line doesn't become an unretrievable sliver. */
export function chunkSections(sections: ExtractedSection[]): Chunk[] {
  // Pass 1: merge consecutive tiny sections (keep the FIRST locator of a merged run —
  // for PDFs that's the starting page, for HTML the covering heading).
  const merged: ExtractedSection[] = [];
  for (const s of sections) {
    const text = normalizedSectionText(s.text);
    if (!text) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.locator === s.locator && prev.text.length < CHUNK_MIN_CHARS) {
      prev.text = `${prev.text} ${text}`;
    } else if (
      prev &&
      prev.locator === s.locator &&
      text.length < CHUNK_MIN_CHARS &&
      prev.text.length + text.length <= CHUNK_TARGET_CHARS
    ) {
      prev.text = `${prev.text} ${text}`;
    } else {
      merged.push({ locator: s.locator, text });
    }
  }
  // Pass 2: split what's left.
  const chunks: Chunk[] = [];
  for (const section of merged) {
    for (const c of chunkSection(section)) {
      chunks.push({ seq: chunks.length, ...c });
    }
  }
  return chunks;
}
