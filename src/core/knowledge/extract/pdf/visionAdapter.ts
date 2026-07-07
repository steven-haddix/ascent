import { generateText, Output } from "ai";
import { z } from "zod";
import { getModelFor } from "../../../ai/service";
import type { PdfJsPageLike } from "./types";

const VisionPageSchema = z.object({
  text: z.string().describe("Faithful page transcription in reading order, using Markdown where structure matters"),
  warnings: z.array(z.string()).describe("Brief extraction uncertainties; empty when none"),
});

async function renderPage(page: PdfJsPageLike): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1800 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("could not create PDF page canvas");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.88);
}

export async function extractPdfPageWithVision(
  page: PdfJsPageLike,
  pageNumber: number,
): Promise<{ text: string; warnings: string[] }> {
  const image = await renderPage(page);
  const { output } = await generateText({
    model: getModelFor("extract"),
    output: Output.object({ schema: VisionPageSchema }),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Transcribe page ${pageNumber} faithfully for document retrieval. Preserve headings, paragraphs, ` +
              "lists, captions, equations, and tables (tables as Markdown). Follow visual reading order. " +
              "Exclude running headers, running footers, and standalone page numbers. Do not summarize, explain, " +
              "or invent obscured text. Return an empty string only when the page contains no meaningful content.",
          },
          { type: "image", image },
        ],
      },
    ],
  });
  if (!output) throw new Error("vision extractor returned no structured output");
  return { text: output.text.trim(), warnings: output.warnings };
}

