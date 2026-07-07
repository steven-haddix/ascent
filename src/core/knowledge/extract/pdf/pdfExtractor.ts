import { getPdfExtractionSettings, getTaskModelSelection } from "../../../settings";
import type { DocumentExtractor } from "../../types";
import { removePageFurniture } from "./furniture";
import { extractLocalPdfPage, loadPdfDocument, PDFJS_ADAPTER_VERSION } from "./pdfjsAdapter";
import { assessPdfPage, selectVisionPages } from "./quality";
import type { PdfExtractedPage, PdfJsPageLike } from "./types";
import { extractPdfPageWithVision } from "./visionAdapter";

export const pdfExtractor: DocumentExtractor = {
  id: "pdf",
  label: "PDF extraction",
  tier: "orchestrated",
  accepts: (mime) => mime === "application/pdf",
  async extract({ bytes }) {
    const policy = getPdfExtractionSettings();
    const doc = await loadPdfDocument(bytes);
    try {
      const proxies: PdfJsPageLike[] = [];
      const localPages = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const proxy = await doc.getPage(pageNumber);
        proxies.push(proxy);
        localPages.push(await extractLocalPdfPage(proxy, pageNumber));
      }

      const cleaned = removePageFurniture(localPages);
      const qualities = cleaned.pages.map(assessPdfPage);
      const visionPageNumbers = new Set(
        selectVisionPages(qualities, policy.visionMode, policy.maxVisionPages),
      );
      const pages: PdfExtractedPage[] = [];

      for (let i = 0; i < cleaned.pages.length; i++) {
        const local = cleaned.pages[i];
        const quality = qualities[i];
        let visionWarning: string | null = null;
        if (visionPageNumbers.has(local.page)) {
          try {
            const vision = await extractPdfPageWithVision(proxies[i], local.page);
            if (vision.text) {
              pages.push({
                page: local.page,
                text: vision.text,
                quality,
                provenance: "vision",
                warnings: vision.warnings,
              });
              continue;
            }
            visionWarning = "vision returned no meaningful text";
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            pages.push({
              page: local.page,
              text: local.text,
              quality,
              provenance: "pdfjs",
              warnings: [`vision fallback failed: ${message}`],
            });
            continue;
          }
        }
        pages.push({
          page: local.page,
          text: local.text,
          quality,
          provenance: "pdfjs",
          warnings: [
            ...quality.reasons,
            ...(visionWarning ? [visionWarning] : []),
            ...(
              policy.visionMode !== "none" &&
              (policy.visionMode === "full" || quality.level !== "good") &&
              !visionPageNumbers.has(local.page)
                ? ["vision page limit reached"]
                : []
            ),
          ],
        });
      }

      let title: string | undefined;
      try {
        const info = (await doc.getMetadata())?.info;
        if (info?.Title?.trim()) title = info.Title.trim();
      } catch {
        // Metadata is optional and must never sink otherwise usable page text.
      }

      const usedVision = pages.some((page) => page.provenance === "vision");
      const selection = visionPageNumbers.size > 0 ? getTaskModelSelection("extract") : null;
      return {
        title,
        extractorId: usedVision ? (policy.visionMode === "full" ? "pdf-vision" : "pdf-hybrid") : "local-pdf",
        sections: pages.filter((page) => page.text.trim()).map((page) => ({ locator: `p.${page.page}`, text: page.text })),
        meta: {
          pageCount: doc.numPages,
          extraction: {
            visionMode: policy.visionMode,
            localAdapterVersion: PDFJS_ADAPTER_VERSION,
            ...(selection ? { routeId: selection.routeId, modelId: selection.modelId } : {}),
            pages: pages.map((page) => ({
              page: page.page,
              provenance: page.provenance,
              quality: page.quality.level,
              warnings: page.warnings,
            })),
          },
        },
      };
    } finally {
      await doc.destroy().catch(() => {});
    }
  },
};
