import { describe, expect, it } from "vitest";
import { clampImageScale, zoomImageAt } from "./ZoomableImage";

describe("image viewer transforms", () => {
  it("clamps zoom to the supported range", () => {
    expect(clampImageScale(0.25)).toBe(1);
    expect(clampImageScale(3)).toBe(3);
    expect(clampImageScale(9)).toBe(5);
  });

  it("keeps the cursor anchor stationary while zooming", () => {
    expect(zoomImageAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: -40 })).toEqual({
      scale: 2,
      x: -100,
      y: 40,
    });
  });

  it("returns to the fitted origin at minimum zoom", () => {
    expect(zoomImageAt({ scale: 2, x: 80, y: -20 }, 1, { x: 10, y: 10 })).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });
});
