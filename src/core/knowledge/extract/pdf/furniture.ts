import { withPageText } from "./layout";
import type { PdfLine, PdfLocalPage } from "./types";

const MARGIN_FRACTION = 0.09;

function band(page: PdfLocalPage, line: PdfLine): "top" | "bottom" | null {
  if (line.y >= page.height * (1 - MARGIN_FRACTION)) return "top";
  if (line.y <= page.height * MARGIN_FRACTION) return "bottom";
  return null;
}

function isStandalonePageNumber(text: string): boolean {
  return /^(?:page\s*)?(?:\d+|[ivxlcdm]+)(?:\s*(?:\/|of)\s*\d+)?$/i.test(text.trim());
}

function romanValue(raw: string): number | null {
  if (!/^[ivxlcdm]+$/i.test(raw)) return null;
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const chars = raw.toLocaleLowerCase().split("");
  let total = 0;
  for (let i = 0; i < chars.length; i++) {
    const value = values[chars[i]];
    total += value < (values[chars[i + 1]] ?? 0) ? -value : value;
  }
  return total;
}

function folioValue(text: string): number | null {
  const match = /^(?:page\s*)?(\d+|[ivxlcdm]+)(?:\s*(?:\/|of)\s*\d+)?$/i.exec(text.trim());
  if (!match) return null;
  return /^\d+$/.test(match[1]) ? Number(match[1]) : romanValue(match[1]);
}

/** Normalize variable folio numbers without knowing any publisher/header strings. */
export function furnitureFingerprint(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim();
}

/**
 * Remove only high-confidence page furniture: standalone folios in a margin or
 * normalized text recurring in the same margin across a meaningful page share.
 */
export function removePageFurniture(pages: PdfLocalPage[]): { pages: PdfLocalPage[]; removed: number } {
  const occurrences = new Map<string, Set<number>>();
  const folioOffsets = new Map<string, number>();
  for (const page of pages) {
    for (const line of page.lines) {
      const location = band(page, line);
      if (!location) continue;
      const folio = folioValue(line.text);
      if (folio !== null) {
        const key = `${location}:${folio - page.page}`;
        folioOffsets.set(key, (folioOffsets.get(key) ?? 0) + 1);
        continue;
      }
      const fingerprint = furnitureFingerprint(line.text);
      if (fingerprint.length < 3) continue;
      const key = `${location}:${fingerprint}`;
      const pageNumbers = occurrences.get(key) ?? new Set<number>();
      pageNumbers.add(page.page);
      occurrences.set(key, pageNumbers);
    }
  }

  // Three pages prevents short-document coincidences; 30% permits alternating
  // odd/even running headers without special-casing either layout.
  const recurrenceThreshold = Math.max(3, Math.ceil(pages.length * 0.3));
  const trustedFolioBands = new Set(
    [...folioOffsets.entries()]
      .filter(([, count]) => count >= recurrenceThreshold)
      .map(([key]) => key.split(":", 1)[0]),
  );
  let removed = 0;
  const cleaned = pages.map((page) => {
    const lines = page.lines.filter((line) => {
      const location = band(page, line);
      if (!location) return true;
      if (isStandalonePageNumber(line.text) && trustedFolioBands.has(location)) {
        removed++;
        return false;
      }
      const key = `${location}:${furnitureFingerprint(line.text)}`;
      if ((occurrences.get(key)?.size ?? 0) >= recurrenceThreshold) {
        removed++;
        return false;
      }
      return true;
    });
    return withPageText(page, lines);
  });
  return { pages: cleaned, removed };
}
