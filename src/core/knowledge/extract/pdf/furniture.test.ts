import { describe, expect, it } from "vitest";
import { removePageFurniture } from "./furniture";
import type { PdfLine, PdfLocalPage } from "./types";

function line(text: string, y: number): PdfLine {
  return { text, x: 40, endX: 300, y, height: 10, breakAfter: true };
}

function page(number: number, header: string): PdfLocalPage {
  const lines = [line(header, 770), line("A repeated phrase in meaningful body text.", 400), line(String(number), 20)];
  return {
    page: number,
    width: 600,
    height: 800,
    lines,
    text: lines.map((value) => value.text).join("\n"),
    stats: { itemCount: 3, singleCharacterItems: 0, replacementCharacters: 0, alphabeticCharacters: 50 },
  };
}

describe("removePageFurniture", () => {
  it("removes recurring variable headers and folios while retaining repeated body prose", () => {
    const input = Array.from({ length: 6 }, (_, index) => page(index + 1, `SAGE · ${index + 1}`));
    const result = removePageFurniture(input);
    expect(result.removed).toBe(12);
    for (const cleaned of result.pages) {
      expect(cleaned.text).toBe("A repeated phrase in meaningful body text.");
    }
  });

  it("supports alternating running headers without publisher-specific rules", () => {
    const input = Array.from({ length: 6 }, (_, index) =>
      page(index + 1, index % 2 === 0 ? "Paper title" : "Chapter title"),
    );
    const result = removePageFurniture(input);
    expect(result.pages.every((value) => !value.text.includes("title"))).toBe(true);
  });

  it("keeps an isolated margin number when there is no document-level folio pattern", () => {
    const input = [page(1, "Unique cover")];
    const result = removePageFurniture(input);
    expect(result.pages[0].text).toContain("1");
  });
});
