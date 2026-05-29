import { describe, it, expect } from "vitest";
import { findTermHits, mergeMarks, type LocatedHighlight } from "./marks";
import type { Term } from "../../core/types";

const term = (t: string): Term => ({ term: t, gloss: "" });
const hl = (id: string, start: number, end: number): LocatedHighlight => ({ id, gloss: null, start, end });

describe("findTermHits", () => {
  it("finds a term occurrence as a [start,end) range", () => {
    expect(findTermHits("the cat sat", [term("cat")])).toEqual([{ start: 4, end: 7, term: term("cat") }]);
  });

  it("prefers the longer term when one contains another", () => {
    const hits = findTermHits("attention head wins", [term("attention"), term("attention head")]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ start: 0, end: 14 });
  });

  it("returns nothing when there are no terms", () => {
    expect(findTermHits("plain text", [])).toEqual([]);
  });
});

describe("mergeMarks", () => {
  it("wraps a term and leaves the rest plain", () => {
    const pieces = mergeMarks("the cat sat", [{ start: 4, end: 7, term: term("cat") }], []);
    expect(pieces.map((p) => p.text)).toEqual(["the ", "cat", " sat"]);
    expect(pieces[1].term).toEqual(term("cat"));
    expect(pieces[0].term).toBeUndefined();
  });

  it("wraps a highlight", () => {
    const pieces = mergeMarks("hello world", [], [hl("h", 0, 5)]);
    expect(pieces.map((p) => p.text)).toEqual(["hello", " world"]);
    expect(pieces[0].highlight?.id).toBe("h");
  });

  it("splits an overlapping term and highlight, marking the shared span as both", () => {
    // "abcdef": term [1,4) "bcd", highlight [3,6) "def" → shared char "d"
    const pieces = mergeMarks("abcdef", [{ start: 1, end: 4, term: term("bcd") }], [hl("h", 3, 6)]);
    expect(pieces.map((p) => p.text)).toEqual(["a", "bc", "d", "ef"]);
    const shared = pieces.find((p) => p.text === "d")!;
    expect(shared.term).toBeDefined();
    expect(shared.highlight?.id).toBe("h");
    expect(pieces.find((p) => p.text === "ef")!.term).toBeUndefined();
  });

  it("keeps adjacent (non-overlapping) marks as separate pieces", () => {
    const pieces = mergeMarks("abcdef", [{ start: 0, end: 3, term: term("abc") }], [hl("h", 3, 6)]);
    expect(pieces.map((p) => p.text)).toEqual(["abc", "def"]);
    expect(pieces[0].term).toBeDefined();
    expect(pieces[0].highlight).toBeUndefined();
    expect(pieces[1].highlight?.id).toBe("h");
  });
});
