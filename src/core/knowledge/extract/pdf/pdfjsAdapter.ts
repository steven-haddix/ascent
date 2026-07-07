import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { linesFromItems, repairInterleavedColumns, textFromLines } from "./layout";
import type { PdfJsPageLike, PdfLocalPage, PdfTextItem } from "./types";

export const PDFJS_ADAPTER_VERSION = 2;

export interface PdfJsDocumentLike {
  numPages: number;
  getPage(page: number): Promise<PdfJsPageLike>;
  getMetadata(): Promise<{ info?: { Title?: string } }>;
  destroy(): Promise<void>;
}

export async function loadPdfDocument(bytes: Uint8Array): Promise<PdfJsDocumentLike> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    disableStream: true,
    disableAutoFetch: true,
    cMapUrl: "/pdfjs-assets/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs-assets/standard_fonts/",
    wasmUrl: "/pdfjs-assets/wasm/",
  });
  const doc = await loadingTask.promise;
  return {
    numPages: doc.numPages,
    getPage: (page) => doc.getPage(page) as unknown as Promise<PdfJsPageLike>,
    getMetadata: () => doc.getMetadata() as unknown as Promise<{ info?: { Title?: string } }>,
    destroy: () => loadingTask.destroy(),
  };
}

export async function readPdfTextItems(page: PdfJsPageLike): Promise<PdfTextItem[]> {
  const reader = page.streamTextContent().getReader();
  const items: PdfTextItem[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const item of value.items) {
        if (typeof item.str !== "string") continue;
        items.push({
          str: item.str,
          transform: Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0],
          width: typeof item.width === "number" ? item.width : 0,
          height: typeof item.height === "number" ? item.height : 0,
          fontName: item.fontName,
          hasEOL: item.hasEOL,
        });
      }
    }
  } finally {
    reader.releaseLock();
  }
  return items;
}

export async function extractLocalPdfPage(page: PdfJsPageLike, pageNumber: number): Promise<PdfLocalPage> {
  const items = await readPdfTextItems(page);
  const viewport = page.getViewport({ scale: 1 });
  const lines = repairInterleavedColumns(linesFromItems(items), viewport.width);
  const joined = items.map((item) => item.str).join("");
  return {
    page: pageNumber,
    width: viewport.width,
    height: viewport.height,
    lines,
    text: textFromLines(lines),
    stats: {
      itemCount: items.length,
      singleCharacterItems: items.filter((item) => item.str.trim().length === 1).length,
      replacementCharacters: (joined.match(/�/g) ?? []).length,
      alphabeticCharacters: (joined.match(/\p{L}/gu) ?? []).length,
    },
  };
}
