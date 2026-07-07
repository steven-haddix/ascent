import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { MODELS } from "./ai/models";

function makeLocalStorageStub() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as Storage;
}

describe("settings — per-task route/model resolution", () => {
  let stub: Storage;

  beforeEach(() => {
    stub = makeLocalStorageStub();
    globalThis.localStorage = stub;
  });

  afterEach(() => {
    stub.clear();
  });

  it("getTaskRouteId('lesson') equals getRouteId() with no overrides", async () => {
    const { getRouteId, getTaskRouteId } = await import("./settings");
    expect(getTaskRouteId("lesson")).toBe(getRouteId());
  });

  it("getTaskModelId('lesson') equals getModelId() with no overrides", async () => {
    const { getModelId, getTaskModelId } = await import("./settings");
    expect(getTaskModelId("lesson")).toBe(getModelId());
  });

  it("setTaskModelId persists an override and leaves global model unchanged", async () => {
    const { getModelId, getTaskModelId, setTaskModelId } = await import("./settings");
    const overrideId = MODELS.fast; // "claude-haiku-4-5-20251001" — valid on anthropic route
    setTaskModelId("lesson", overrideId);
    expect(getTaskModelId("lesson")).toBe(overrideId);
    expect(getModelId()).not.toBe(overrideId); // global model is still the default (Sonnet)
  });

  it("inherits provider settings with the default route/model selection", async () => {
    const {
      getModelId,
      getRouteId,
      getTaskModelProviderSettings,
      setModelProviderSettings,
    } = await import("./settings");
    const settings = {
      adapter: "anthropic",
      version: 1,
      value: { thinking: { type: "adaptive" }, effort: "medium" },
    };
    setModelProviderSettings(getRouteId(), getModelId(), settings);
    expect(getTaskModelProviderSettings("lesson")).toEqual(settings);
    // Widget has a registry-level Haiku default, so Sonnet settings do not leak.
    expect(getTaskModelProviderSettings("widget")).toBeNull();
  });

  it("clears provider settings together with a task override", async () => {
    const {
      clearTaskOverride,
      getTaskModelId,
      getTaskModelProviderSettings,
      getTaskRouteId,
      setTaskModelId,
      setTaskModelProviderSettings,
    } = await import("./settings");
    setTaskModelId("tutor", MODELS.flagshipPrev);
    setTaskModelProviderSettings("tutor", getTaskRouteId("tutor"), getTaskModelId("tutor"), {
      adapter: "anthropic",
      version: 1,
      value: { thinking: { type: "adaptive" }, effort: "max" },
    });
    expect(getTaskModelProviderSettings("tutor")).not.toBeNull();
    clearTaskOverride("tutor");
    expect(getTaskModelProviderSettings("tutor")).toBeNull();
  });

  it("defaults PDF extraction to local-only and persists an explicit paid mode", async () => {
    const { getPdfExtractionSettings, setPdfExtractionSettings } = await import("./settings");
    expect(getPdfExtractionSettings()).toEqual({ visionMode: "none", maxVisionPages: 20 });
    setPdfExtractionSettings({ visionMode: "hybrid", maxVisionPages: 10 });
    expect(getPdfExtractionSettings()).toEqual({ visionMode: "hybrid", maxVisionPages: 10 });
  });

  it("resolves a vision-capable model for document extraction", async () => {
    const { getTaskModelId } = await import("./settings");
    const model = getTaskModelId("extract");
    expect(model).toBeTruthy();
  });
});
