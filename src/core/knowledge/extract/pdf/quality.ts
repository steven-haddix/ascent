import type { PdfLocalPage, PdfPageQuality } from "./types";

/** Conservative: uncertain pages stay local rather than creating surprise spend. */
export function assessPdfPage(page: PdfLocalPage): PdfPageQuality {
  const text = page.text.trim();
  if (text.length < 20) return { level: "empty", reasons: ["little-or-no-embedded-text"] };

  const reasons: string[] = [];
  const replacementRatio = page.stats.replacementCharacters / Math.max(text.length, 1);
  const alphaRatio = page.stats.alphabeticCharacters / Math.max(text.length, 1);
  const singleItemRatio = page.stats.singleCharacterItems / Math.max(page.stats.itemCount, 1);
  if (replacementRatio > 0.01) reasons.push("broken-character-encoding");
  if (text.length > 100 && alphaRatio < 0.2) reasons.push("low-readable-text-ratio");
  if (page.stats.itemCount > 80 && singleItemRatio > 0.8) reasons.push("highly-fragmented-glyphs");
  return { level: reasons.length ? "weak" : "good", reasons };
}

export function selectVisionPages(
  qualities: PdfPageQuality[],
  mode: "none" | "hybrid" | "full",
  limit: number,
): number[] {
  if (mode === "none") return [];
  const candidates = qualities
    .map((quality, index) => ({ quality, page: index + 1 }))
    .filter(({ quality }) => mode === "full" || quality.level !== "good")
    .map(({ page }) => page);
  return candidates.slice(0, Math.max(0, limit));
}

