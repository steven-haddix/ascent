import { describe, expect, it } from "vitest";
import { linesFromItems, repairInterleavedColumns, textFromLines } from "./layout";
import type { PdfLine } from "./types";
import type { PdfTextItem } from "./types";

function item(str: string, x: number, y: number, width: number, hasEOL = false): PdfTextItem {
  return { str, transform: [1, 0, 0, 10, x, y], width, height: 10, hasEOL };
}

describe("PDF layout reconstruction", () => {
  it("joins adjacent font runs but preserves visual word gaps", () => {
    const lines = linesFromItems([
      item("S", 10, 700, 6),
      item("pherical", 16.2, 700, 38),
      item("adaptive", 59, 700, 42, true),
    ]);
    expect(lines[0].text).toBe("Spherical adaptive");
  });

  it("repairs lowercase words hyphenated across layout lines", () => {
    const lines = linesFromItems([
      item("adap-", 10, 700, 25, true),
      item("tive routing", 10, 686, 55, true),
    ]);
    expect(textFromLines(lines)).toBe("adaptive routing");
  });

  it("preserves semantic compound hyphens without inserting wrap whitespace", () => {
    const lines = linesFromItems([
      item("Mises-", 10, 700, 25, true),
      item("Fisher", 10, 686, 30, true),
    ]);
    expect(textFromLines(lines)).toBe("Mises-Fisher");
  });

  it("keeps plausible lowercase compounds rather than corrupting them", () => {
    const lines = linesFromItems([
      item("novelty-", 10, 700, 40, true),
      item("detection", 10, 686, 45, true),
    ]);
    expect(textFromLines(lines)).toBe("novelty-detection");
  });

  it("repairs strongly interleaved two-column line order", () => {
    const lines: PdfLine[] = [];
    for (let row = 0; row < 5; row++) {
      lines.push({ text: `L${row}`, x: 50, endX: 250, y: 700 - row * 20, height: 10, breakAfter: true });
      lines.push({ text: `R${row}`, x: 350, endX: 550, y: 700 - row * 20, height: 10, breakAfter: true });
    }
    expect(repairInterleavedColumns(lines, 600).map((line) => line.text)).toEqual([
      "L0", "L1", "L2", "L3", "L4", "R0", "R1", "R2", "R3", "R4",
    ]);
  });
});
