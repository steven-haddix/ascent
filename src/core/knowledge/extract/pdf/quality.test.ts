import { describe, expect, it } from "vitest";
import { assessPdfPage, selectVisionPages } from "./quality";
import type { PdfLocalPage } from "./types";

function page(text: string): PdfLocalPage {
  return {
    page: 1,
    width: 600,
    height: 800,
    lines: [],
    text,
    stats: {
      itemCount: 10,
      singleCharacterItems: 0,
      replacementCharacters: (text.match(/�/g) ?? []).length,
      alphabeticCharacters: (text.match(/\p{L}/gu) ?? []).length,
    },
  };
}

describe("PDF page quality policy", () => {
  it("flags image-only and broken-encoding pages conservatively", () => {
    expect(assessPdfPage(page(" ")).level).toBe("empty");
    expect(assessPdfPage(page(`Readable ${"�".repeat(20)} ${"text ".repeat(30)}`)).level).toBe("weak");
    expect(assessPdfPage(page("A healthy embedded-text page with complete sentences."))).toEqual({
      level: "good",
      reasons: [],
    });
  });

  it("selects no, weak-only, or all pages according to policy and cap", () => {
    const qualities = [
      { level: "good" as const, reasons: [] },
      { level: "empty" as const, reasons: ["empty"] },
      { level: "weak" as const, reasons: ["weak"] },
    ];
    expect(selectVisionPages(qualities, "none", 20)).toEqual([]);
    expect(selectVisionPages(qualities, "hybrid", 20)).toEqual([2, 3]);
    expect(selectVisionPages(qualities, "full", 2)).toEqual([1, 2]);
  });
});
