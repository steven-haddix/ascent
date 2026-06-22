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
});
