// Extractor registry — resolves a stored blob's mime to a DocumentExtractor.
// Own registry, mirroring search/registry.ts (the provider+capability pattern's
// fourth instance). v1 registers the local tier only; the model-vision extractor
// (the `extract` AI task) is added in K3 behind an explicit Settings choice —
// extraction must never spend tokens implicitly.
import type { DocumentExtractor } from "../types";
import { localHtml } from "./localHtml";
import { localPdf } from "./localPdf";
import { localText } from "./localText";

const EXTRACTORS: DocumentExtractor[] = [localPdf, localHtml, localText];

/** The extractor for a blob's (sniffed) mime, or null when nothing accepts it. */
export function extractorFor(mime: string): DocumentExtractor | null {
  return EXTRACTORS.find((e) => e.accepts(mime)) ?? null;
}

export function supportedMime(mime: string): boolean {
  return extractorFor(mime) !== null;
}
