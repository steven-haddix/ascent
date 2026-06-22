import { describe, expect, it } from "vitest";
import { DigestSchema } from "./digest";

const validDigest = {
  recap: "The learner now understands how gradient descent minimizes the loss function.",
  motifs: ["loss surface as terrain", "ball rolling downhill"],
  notation: [
    { symbol: "η", means: "learning rate" },
    { symbol: "∇L", means: "gradient of the loss" },
  ],
  openLoops: ["Why does learning rate scheduling matter?"],
  deferredTo: ["Adaptive optimizers", "Second-order methods"],
  assumedPrereqs: ["Derivatives and partial derivatives", "What a loss function is"],
};

describe("DigestSchema", () => {
  it("accepts a fully-populated digest", () => {
    const result = DigestSchema.safeParse(validDigest);
    expect(result.success).toBe(true);
  });

  it("rejects an empty object (recap is required)", () => {
    const result = DigestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts a minimal digest with empty arrays", () => {
    const result = DigestSchema.safeParse({
      recap: "The learner now understands the basics.",
      motifs: [],
      notation: [],
      openLoops: [],
      deferredTo: [],
      assumedPrereqs: [],
    });
    expect(result.success).toBe(true);
  });
});
