// SPIKE (not shipped) — validates the two LOCAL document extractors the knowledge
// backbone's K1 gates on (plan §8 K0):
//   1. pdfjs-dist: text extraction from a real PDF (fed bytes, no worker — the app
//      will lazy-load the same legacy build in the webview; Vite `?url` worker wiring
//      is a rendering concern we don't need for getTextContent()).
//   2. @mozilla/readability: article extraction from real HTML. The app has a native
//      DOMParser in the webview; linkedom stands in for it here (bun has no DOM).
//
// Run: bun spikes/document-extraction.ts <path-to.pdf> <path-to.html> [...]
// Pass/fail is judged by eye: does the text read like the document?
import { readFileSync } from "node:fs";

async function pdfText(path: string): Promise<{ pages: number; text: string }> {
  // The legacy build runs in plain JS environments; disable the worker explicitly.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, disableWorker: true } as never).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ");
    parts.push(`[p.${p}] ${line}`);
  }
  return { pages: doc.numPages, text: parts.join("\n") };
}

async function htmlArticle(path: string): Promise<{ title: string; length: number; excerpt: string }> {
  const { parseHTML } = await import("linkedom");
  const { Readability } = await import("@mozilla/readability");
  const html = readFileSync(path, "utf8");
  const { document } = parseHTML(html);
  const article = new Readability(document as never).parse();
  if (!article?.textContent) throw new Error("readability returned nothing");
  const text = article.textContent.replace(/\s+/g, " ").trim();
  return { title: article.title ?? "(untitled)", length: text.length, excerpt: text.slice(0, 400) };
}

for (const path of process.argv.slice(2)) {
  console.log(`\n=== ${path} ===`);
  try {
    if (path.endsWith(".pdf")) {
      const { pages, text } = await pdfText(path);
      console.log(`pages: ${pages}, chars: ${text.length}`);
      console.log("first 400:", text.slice(0, 400));
      console.log("…middle 400:", text.slice(Math.floor(text.length / 2), Math.floor(text.length / 2) + 400));
    } else {
      const a = await htmlArticle(path);
      console.log(`title: ${a.title}, chars: ${a.length}`);
      console.log("first 400:", a.excerpt);
    }
  } catch (err) {
    console.error("FAILED:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
