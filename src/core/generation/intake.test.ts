import { describe, expect, it } from "vitest";
import { facetsFromAnswers } from "./intake";
import { guessRole } from "../knowledge/types";
import type { IntakeAnswer } from "../types";

describe("facetsFromAnswers", () => {
  it("builds labeled facets from answered questions, skipping unlabeled/blank ones", () => {
    const history: IntakeAnswer[] = [
      { prompt: "What's driving this?", selected: "A course I'm taking", facetLabel: "Motivation" },
      { prompt: "Depth?", selected: "Intuition first", other: "but rigorous", facetLabel: "Math depth" },
      { prompt: "no label", selected: "x" }, // no facetLabel → skipped
      { prompt: "labeled but blank", facetLabel: "Scope" }, // no value → skipped
    ];
    expect(facetsFromAnswers(history)).toEqual([
      { label: "Motivation", value: "A course I'm taking" },
      { label: "Math depth", value: "Intuition first — but rigorous" },
    ]);
  });

  it("returns [] for an empty transcript", () => {
    expect(facetsFromAnswers([])).toEqual([]);
  });
});

describe("guessRole", () => {
  it("routes syllabus-like names to syllabus", () => {
    expect(guessRole("rl-course-syllabus.md")).toBe("syllabus");
    expect(guessRole("Fall2026_Outline.pdf")).toBe("syllabus");
    expect(guessRole("weekly schedule.txt")).toBe("syllabus");
  });
  it("routes book-like documents to ground-truth", () => {
    expect(guessRole("sutton-barto.pdf")).toBe("ground-truth");
    expect(guessRole("thesis.docx")).toBe("ground-truth");
    expect(guessRole("book.epub")).toBe("ground-truth");
  });
  it("defaults everything else to reference", () => {
    expect(guessRole("notes.md")).toBe("reference");
    expect(guessRole("article.txt")).toBe("reference");
  });
});
