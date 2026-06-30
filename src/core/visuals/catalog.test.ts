import { describe, it, expect } from "vitest";
import { inferDomain, kindsForDomain, kindsForDomains, visualCatalog } from "./catalog";
import { isGeneratedImageBlock, isTimelineBlock, isSpectrumBlock } from "./guards";
import type { Block } from "../types";

describe("inferDomain", () => {
  it("maps clear topics to their domain", () => {
    expect(inferDomain("The Causes of World War I")).toBe("history");
    expect(inferDomain("Quantum Entanglement")).toBe("science");
    expect(inferDomain("Binary Search Trees in software")).toBe("programming");
  });
  it("does not fall through to general for a STEM concept", () => {
    expect(inferDomain("Gradient Descent")).not.toBe("general");
  });
  it("does not fall through to general for neural architecture concepts", () => {
    expect(inferDomain("Latent Mixture of Experts Models")).not.toBe("general");
  });
  it("falls back to general for unmatched text", () => {
    expect(inferDomain("??? nonsense ???")).toBe("general");
  });
});

describe("kindsForDomain", () => {
  it("offers timeline for history but not for math", () => {
    const history = kindsForDomain("history").map((d) => d.id);
    const math = kindsForDomain("math").map((d) => d.id);
    expect(history).toContain("timeline");
    expect(math).toContain("chart");
    expect(math).toContain("figure");
    expect(math).not.toContain("timeline");
  });
  it("offers architecture-capable figures for programming lessons", () => {
    const programming = kindsForDomain("programming").map((d) => d.id);
    expect(programming).toContain("figure");
  });
  it("every catalog entry requires alt text", () => {
    for (const d of Object.values(visualCatalog)) expect(d.requiresAltText).toBe(true);
  });

  it("offers generated illustrations across domains without replacing exact visual types", () => {
    expect(kindsForDomain("history").map((d) => d.id)).toContain("generated-image");
    expect(kindsForDomain("math").map((d) => d.id)).toEqual(expect.arrayContaining(["chart", "figure", "generated-image"]));
  });

  it("kindsForDomains unions multi-tag domains and dedups", () => {
    const ids = kindsForDomains(["history", "math"]).map((d) => d.id);
    expect(ids).toContain("timeline"); // from history
    expect(ids).toContain("chart"); // from math
    expect(new Set(ids).size).toBe(ids.length); // no duplicates across overlapping affinities
    expect(kindsForDomains([])).toEqual([]);
  });
});

describe("block guards", () => {
  it("isTimelineBlock", () => {
    expect(isTimelineBlock({ kind: "timeline", events: [] } as Block)).toBe(true);
    expect(isTimelineBlock({ kind: "paragraph" } as Block)).toBe(false);
    expect(isTimelineBlock({ kind: "timeline" } as Block)).toBe(false);
  });
  it("isSpectrumBlock", () => {
    expect(isSpectrumBlock({ kind: "spectrum", axis: { min: 0, max: 1 }, items: [] } as Block)).toBe(true);
    expect(isSpectrumBlock({ kind: "spectrum" } as Block)).toBe(false);
    expect(isSpectrumBlock({ kind: "paragraph" } as Block)).toBe(false);
  });
  it("isGeneratedImageBlock requires a durable id and prompt", () => {
    expect(isGeneratedImageBlock({ kind: "generated-image", mediaId: "cell-cutaway", prompt: "A cell cutaway" })).toBe(true);
    expect(isGeneratedImageBlock({ kind: "generated-image", mediaId: "cell-cutaway" })).toBe(false);
  });
});
