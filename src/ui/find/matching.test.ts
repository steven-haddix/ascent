import { describe, expect, it } from "vitest";
import { locateMatches } from "./matching";

describe("locateMatches", () => {
  it("finds a single match with correct offsets", () => {
    expect(locateMatches("the quick brown fox", "quick")).toEqual([{ start: 4, end: 9 }]);
  });

  it("is case-insensitive", () => {
    expect(locateMatches("Gradient Descent gradient", "gradient")).toEqual([
      { start: 0, end: 8 },
      { start: 17, end: 25 },
    ]);
  });

  it("returns non-overlapping matches for repeated patterns", () => {
    // "aa" in "aaaa" → positions 0 and 2, not 0/1/2 (scan advances past each hit)
    expect(locateMatches("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("finds adjacent matches", () => {
    expect(locateMatches("abab", "ab")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("returns [] when there is no match", () => {
    expect(locateMatches("hello world", "xyz")).toEqual([]);
  });

  it("returns [] for an empty query", () => {
    expect(locateMatches("hello", "")).toEqual([]);
  });

  it("returns [] for a whitespace-only query", () => {
    expect(locateMatches("hello world", "   ")).toEqual([]);
  });

  it("matches a query that contains internal whitespace", () => {
    expect(locateMatches("learning rate schedule", "rate sch")).toEqual([{ start: 9, end: 17 }]);
  });
});
