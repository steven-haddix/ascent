import { describe, it, expect } from "vitest";
import { buildAnchor, occurrences, nearestOccurrence, locateAnchor } from "./anchor";

describe("buildAnchor", () => {
  it("captures the exact text plus bounded surrounding context", () => {
    const t = "The quick brown fox jumps";
    const a = buildAnchor(t, 10, 15, 4); // "brown"
    expect(a).toEqual({ exact: "brown", prefix: "ick ", suffix: " fox" });
  });

  it("clamps context at the string edges", () => {
    const t = "abc";
    expect(buildAnchor(t, 0, 1, 10)).toEqual({ exact: "a", prefix: "", suffix: "bc" });
  });
});

describe("occurrences", () => {
  it("finds every start index", () => {
    expect(occurrences("a b a b a", "a")).toEqual([0, 4, 8]);
  });
  it("returns empty for an absent or empty needle", () => {
    expect(occurrences("abc", "z")).toEqual([]);
    expect(occurrences("abc", "")).toEqual([]);
  });
});

describe("nearestOccurrence", () => {
  it("picks the occurrence closest to the hint offset", () => {
    expect(nearestOccurrence("a b a b a", "a", 5)).toBe(4);
    expect(nearestOccurrence("a b a b a", "a", 0)).toBe(0);
    expect(nearestOccurrence("a b a b a", "a", 99)).toBe(8);
  });
  it("returns null when the needle is absent", () => {
    expect(nearestOccurrence("abc", "z", 0)).toBeNull();
  });
});

describe("locateAnchor", () => {
  it("locates a unique match", () => {
    const t = "The quick brown fox";
    expect(locateAnchor(t, { exact: "brown", prefix: "ick ", suffix: " fox" })).toEqual({
      start: 10,
      end: 15,
    });
  });

  it("returns null when the exact text is gone (graceful skip)", () => {
    expect(locateAnchor("the lesson changed", { exact: "brown", prefix: "", suffix: "" })).toBeNull();
  });

  it("disambiguates repeated phrases by surrounding context", () => {
    const t = "cat dog cat"; // "cat" at 0 and 8
    const second = buildAnchor(t, 8, 11, 4); // prefix "dog "
    expect(locateAnchor(t, second)).toEqual({ start: 8, end: 11 });
    const first = buildAnchor(t, 0, 3, 4); // suffix " dog"
    expect(locateAnchor(t, first)).toEqual({ start: 0, end: 3 });
  });
});
