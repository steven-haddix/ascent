// Knowledge library — document extraction contract (knowledge-backbone plan §5).
// Extraction is the FOURTH instance of the provider+capability pattern (after
// embeddings, media, and search): one output shape, many mechanisms. The two
// local extractors are the always-on free/offline floor; the PDF extractor can
// orchestrate the `extract` vision task as an explicit, spend-visible upgrade.
import type { DocumentMeta } from "../types";

/** What every extractor consumes: the stored blob's bytes plus routing hints. */
export interface ExtractInput {
  bytes: Uint8Array;
  mime: string;
  /** display title (used as a fallback section heading) */
  title: string;
}

/** One logical span of the document — a page (PDF) or a heading-scoped run (HTML). */
export interface ExtractedSection {
  /** citation locator: "p.4" for PDFs, a heading path like "Training > Batching" for HTML */
  locator: string | null;
  text: string;
}

export interface ExtractedDoc {
  /** extractor-derived title when the document declares one (HTML <title>, PDF info) */
  title?: string;
  sections: ExtractedSection[];
  /** Mechanism that actually produced this run; may differ per policy for PDFs. */
  extractorId?: string;
  /** Persisted with the document so hybrid/page-level provenance is inspectable. */
  meta?: DocumentMeta;
}

export interface DocumentExtractor {
  id: string; // "pdf" | "local-html" | "local-text"
  label: string;
  /** MIME types this extractor accepts (checked against the sniffed blob mime) */
  accepts: (mime: string) => boolean;
  /** orchestrated = always has a local floor but may use an explicit paid policy */
  tier: "local" | "model" | "orchestrated";
  extract(input: ExtractInput): Promise<ExtractedDoc>;
}

/** A retrieval-ready passage produced by the chunker from extracted sections. */
export interface Chunk {
  seq: number;
  text: string;
  locator: string | null;
}

/** Document kinds a library entry can carry (mirrors the documents.kind enum). */
export type DocumentKind = "web" | "paper" | "video" | "blog" | "docs" | "pdf" | "resume" | "notes";

/** How a document functions in its binding context (mirrors sources.role):
 *  syllabus shapes the tree's structure, ground-truth anchors content/citations,
 *  reference is normal retrieval. */
export type SourceRole = "syllabus" | "ground-truth" | "reference";

/** Heuristic role guess from a filename (topic-creation design `guessRole`) —
 *  a starting point the user can edit, never a final classification. */
export function guessRole(name: string): SourceRole {
  const n = name.toLowerCase();
  if (n.includes("syllab") || n.includes("outline") || n.includes("schedule")) return "syllabus";
  if (/\.(pdf|epub|docx)$/.test(n)) return "ground-truth";
  return "reference";
}
