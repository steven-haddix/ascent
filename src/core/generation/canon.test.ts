import { describe, expect, it } from "vitest";
import { mergeNotationLists, placeInSpineOrder } from "./canon";
import type { CanonNotation } from "../types";

const n = (symbol: string, means: string, firstIntroducedIn: string | null = null): CanonNotation => ({
  symbol,
  means,
  firstIntroducedIn,
});

describe("mergeNotationLists", () => {
  it("keeps the existing entry on a symbol collision (existing wins)", () => {
    const existing = [n("θ", "model parameters", "c1")];
    const additions = [n("θ", "something else", "c5")];
    const merged = mergeNotationLists(existing, additions);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(n("θ", "model parameters", "c1"));
  });

  it("appends new symbols not already present", () => {
    const existing = [n("θ", "model parameters")];
    const additions = [n("η", "learning rate", "c2")];
    const merged = mergeNotationLists(existing, additions);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.symbol)).toEqual(["θ", "η"]);
    expect(merged[1].means).toBe("learning rate");
  });

  it("leaves the list unchanged when additions is empty", () => {
    const existing = [n("θ", "model parameters"), n("η", "learning rate")];
    const merged = mergeNotationLists(existing, []);
    expect(merged).toEqual(existing);
  });

  it("skips additions with an empty symbol", () => {
    const existing = [n("θ", "model parameters")];
    const additions = [n("", "no symbol"), n("η", "learning rate")];
    const merged = mergeNotationLists(existing, additions);
    expect(merged.map((m) => m.symbol)).toEqual(["θ", "η"]);
  });
});

describe("placeInSpineOrder", () => {
  it("inserts the id right after the given afterId", () => {
    expect(placeInSpineOrder(["a", "b", "c"], "x", "b")).toEqual(["a", "b", "x", "c"]);
  });

  it("appends when afterId is null", () => {
    expect(placeInSpineOrder(["a", "b"], "x", null)).toEqual(["a", "b", "x"]);
  });

  it("appends when afterId is absent (undefined)", () => {
    expect(placeInSpineOrder(["a", "b"], "x")).toEqual(["a", "b", "x"]);
  });

  it("appends when afterId is not found in the order", () => {
    expect(placeInSpineOrder(["a", "b"], "x", "zzz")).toEqual(["a", "b", "x"]);
  });

  it("is a no-op when the id is already present", () => {
    const order = ["a", "b", "c"];
    const result = placeInSpineOrder(order, "b", "a");
    expect(result).toEqual(["a", "b", "c"]);
  });
});
