// Extractor registry — resolves a stored blob's mime to a DocumentExtractor.
// Own registry, mirroring search/registry.ts (the provider+capability pattern's
// fourth instance). The PDF entry is an orchestrator: PDF.js is always the local
// floor and the `extract` vision task is enabled only by explicit Settings policy.
import type { DocumentExtractor } from "../types";
import { localHtml } from "./localHtml";
import { pdfExtractor } from "./pdf/pdfExtractor";
import { localText } from "./localText";

const EXTRACTORS: DocumentExtractor[] = [pdfExtractor, localHtml, localText];

/** The extractor for a blob's (sniffed) mime, or null when nothing accepts it. */
export function extractorFor(mime: string): DocumentExtractor | null {
  return EXTRACTORS.find((e) => e.accepts(mime)) ?? null;
}

export function supportedMime(mime: string): boolean {
  return extractorFor(mime) !== null;
}
