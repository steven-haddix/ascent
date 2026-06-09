import { describe, it, expect } from "vitest";
import { normalizeWidgetSlug, widgetKeysFor } from "./keys";
import type { Block } from "../types";

const widget = (over: Partial<Block> = {}): Block => ({
  kind: "widget",
  widgetId: "gradient-descent-slider",
  title: "Gradient descent playground",
  spec: "A slider controls the learning rate; dots animate down a parabola.",
  ...over,
});

describe("normalizeWidgetSlug", () => {
  it("kebabs and trims a model-minted slug", () => {
    expect(normalizeWidgetSlug("  Gradient Descent!! Slider ", undefined, 0)).toBe("gradient-descent-slider");
  });

  it("derives from the title when the slug is missing", () => {
    expect(normalizeWidgetSlug(undefined, "Learning Rate Playground", 0)).toBe("learning-rate-playground");
    expect(normalizeWidgetSlug("   ", "Learning Rate Playground", 0)).toBe("learning-rate-playground");
  });

  it("falls back to the block position when both are empty", () => {
    expect(normalizeWidgetSlug(undefined, undefined, 4)).toBe("widget-5");
    expect(normalizeWidgetSlug("!!!", "???", 0)).toBe("widget-1");
  });

  it("caps length without leaving a trailing dash", () => {
    const slug = normalizeWidgetSlug("a".repeat(40) + "-" + "b".repeat(40), undefined, 0);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("widgetKeysFor", () => {
  it("keys widget blocks by index, ignoring other kinds", () => {
    const blocks: Block[] = [{ kind: "paragraph", text: "hi" }, widget(), { kind: "section", label: "next" }];
    const keys = widgetKeysFor(blocks);
    expect(keys.size).toBe(1);
    expect(keys.get(1)).toBe("gradient-descent-slider");
  });

  it("dedupes colliding slugs deterministically by block order", () => {
    const blocks: Block[] = [widget(), widget(), widget()];
    const keys = widgetKeysFor(blocks);
    expect(keys.get(0)).toBe("gradient-descent-slider");
    expect(keys.get(1)).toBe("gradient-descent-slider-2");
    expect(keys.get(2)).toBe("gradient-descent-slider-3");
  });

  it("skips incomplete widget blocks — the renderable rule — so raw and filtered block lists agree", () => {
    const incomplete = widget({ spec: "  " });
    const raw: Block[] = [incomplete, { kind: "paragraph", text: "x" }, widget()];
    const filtered: Block[] = [{ kind: "paragraph", text: "x" }, widget()];
    expect(widgetKeysFor(raw).get(2)).toBe("gradient-descent-slider");
    expect(widgetKeysFor(filtered).get(1)).toBe("gradient-descent-slider");
    expect(widgetKeysFor(raw).size).toBe(1);
  });

  it("keys for earlier blocks never change as later blocks stream in", () => {
    const first = widget({ widgetId: "alpha" });
    const before = widgetKeysFor([first]);
    const after = widgetKeysFor([first, widget({ widgetId: "alpha" }), widget({ widgetId: "beta" })]);
    expect(after.get(0)).toBe(before.get(0));
  });
});
