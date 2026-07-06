// local-pdf extractor — pdfjs-dist text extraction, one section per page. The
// legacy build is dynamic-imported so the ~1MB library stays out of the main bundle
// (the KaTeX/Mermaid/Pyodide pattern).
//
// pdf.js v6 REQUIRES a configured worker — `disableWorker` is not honored in the
// Tauri (WKWebView) runtime and getDocument throws `No "GlobalWorkerOptions.
// workerSrc" specified.` immediately. (The K0 spike ran under bun, which tolerated
// disableWorker, so this webview-only failure was missed.) Vite bundles the worker
// as a same-origin asset via `?url`; it runs off-thread, which also keeps the
// background extraction from blocking the UI.
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { DocumentExtractor, ExtractedSection } from "../types";

type PdfTextChunk = { items: Array<{ str?: string }> };

/**
 * pdf.js implements getTextContent() with `for await (const chunk of stream)`.
 * Older WKWebView versions support ReadableStream#getReader but not the stream's
 * async-iterator protocol, so consume the same public stream through its reader.
 */
export async function textFromPdfPage(page: {
  streamTextContent(): ReadableStream<PdfTextChunk>;
}): Promise<string> {
  const reader = page.streamTextContent().getReader();
  const parts: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const item of value.items) {
        if (typeof item.str === "string") parts.push(item.str);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export const localPdf: DocumentExtractor = {
  id: "local-pdf",
  label: "Built-in PDF text",
  tier: "local",
  accepts: (mime) => mime === "application/pdf",
  async extract({ bytes }) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    // The whole PDF is already in memory (`data`), so pdf.js's streaming/auto-fetch
    // transport is pointless — and it appears to be what breaks in the Tauri webview
    // (`undefined is not a function (near '…value of readableStream…')`). Disable it.
    const doc = await pdfjs.getDocument({
      data: bytes,
      disableStream: true,
      disableAutoFetch: true,
    }).promise;
    const sections: ExtractedSection[] = [];
    let title: string | undefined;
    try {
      const info = (await doc.getMetadata())?.info as { Title?: string } | undefined;
      if (info?.Title?.trim()) title = info.Title.trim();
    } catch {
      /* metadata is optional */
    }
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const text = await textFromPdfPage(page);
      if (text) sections.push({ locator: `p.${p}`, text });
    }
    return { title, sections };
  },
};
