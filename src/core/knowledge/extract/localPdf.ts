// Compatibility exports for the PDF extractor. The implementation lives under
// ./pdf, where local layout and optional vision orchestration stay separated.
//
// pdf.js v6 REQUIRES a configured worker — `disableWorker` is not honored in the
// Tauri (WKWebView) runtime and getDocument throws `No "GlobalWorkerOptions.
// workerSrc" specified.` immediately. (The K0 spike ran under bun, which tolerated
// disableWorker, so this webview-only failure was missed.) Vite bundles the worker
// as a same-origin asset via `?url`; it runs off-thread, which also keeps the
// background extraction from blocking the UI.
import type { PdfJsPageLike } from "./pdf/types";
import { readPdfTextItems } from "./pdf/pdfjsAdapter";
export { pdfExtractor as localPdf } from "./pdf/pdfExtractor";

type PdfTextChunk = { items: Array<{ str?: string }> };

/**
 * pdf.js implements getTextContent() with `for await (const chunk of stream)`.
 * Older WKWebView versions support ReadableStream#getReader but not the stream's
 * async-iterator protocol, so consume the same public stream through its reader.
 */
export async function textFromPdfPage(page: {
  streamTextContent(): ReadableStream<PdfTextChunk>;
}): Promise<string> {
  const items = await readPdfTextItems(page as PdfJsPageLike);
  return items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();
}
