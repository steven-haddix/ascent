import { describe, it, expect } from "vitest";
import { AI_TASKS, requiredCapabilityOf, type AiTaskId } from "./tasks";
import { MODELS } from "./models";

describe("AI_TASKS registry", () => {
  it("every AiTaskId key exists in AI_TASKS with a matching id field", () => {
    const keys = Object.keys(AI_TASKS) as AiTaskId[];
    for (const key of keys) {
      expect(AI_TASKS[key].id).toBe(key);
    }
  });

  it("all ids are unique", () => {
    const ids = Object.values(AI_TASKS).map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("digest uses MODELS.fast as defaultModelId", () => {
    expect(AI_TASKS.digest.defaultModelId).toBe(MODELS.fast);
  });
});

describe("requiredCapabilityOf", () => {
  it("returns 'embeddings' for embed", () => {
    expect(requiredCapabilityOf("embed")).toBe("embeddings");
  });

  it("defaults to 'textGeneration' for lesson (no requiredCapability set)", () => {
    expect(requiredCapabilityOf("lesson")).toBe("textGeneration");
  });

  it("returns 'textGeneration' for digest (explicitly set)", () => {
    expect(requiredCapabilityOf("digest")).toBe("textGeneration");
  });

  it("requires vision for document extraction", () => {
    expect(requiredCapabilityOf("extract")).toBe("vision");
  });
});
