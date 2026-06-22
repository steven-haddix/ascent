import { describe, expect, it } from "vitest";
import { buildLessonPrompt, type LessonContext } from "./lessonPrompt";

// A fixed, representative context — the snapshot of buildLessonPrompt(concept, ctx)
// with no parts is the byte-identity guard for later waves: any change to the
// default prompt text must be an intentional snapshot update.
const concept = { title: "Gradient descent" };
const ctx: LessonContext = {
  topicTitle: "Optimization",
  path: ["Machine Learning", "Optimization"],
  summary: "how iterative steps minimize a loss",
  siblings: ["Newton's method", "Momentum"],
  children: ["Learning rate", "Convergence"],
  existingConcepts: [
    { handle: "c1", conceptId: "id-1", title: "Loss functions", summary: "what we minimize" },
    { handle: "c2", conceptId: "id-2", title: "Derivatives", summary: null },
  ],
  briefSummary: "learner is comfortable with calculus, wants ML intuition",
};

describe("buildLessonPrompt", () => {
  it("produces the default prompt verbatim (byte-identity guard)", () => {
    expect(buildLessonPrompt(concept, ctx)).toMatchSnapshot();
  });

  it("injects a non-empty continuity section into the output", () => {
    const marker = "CONTINUITY_MARKER_XYZ";
    const out = buildLessonPrompt(concept, ctx, { continuity: marker });
    expect(out).toContain(marker);
  });

  it("appends a non-empty format addendum into the output", () => {
    const marker = "FORMAT_ADDENDUM_MARKER_XYZ";
    const out = buildLessonPrompt(concept, ctx, { formatAddendum: marker });
    expect(out).toContain(marker);
  });

  it("does NOT contain injected markers when parts is empty", () => {
    const out = buildLessonPrompt(concept, ctx, {});
    expect(out).not.toContain("CONTINUITY_MARKER_XYZ");
    expect(out).not.toContain("FORMAT_ADDENDUM_MARKER_XYZ");
  });

  it("an empty parts object yields the same output as no parts at all", () => {
    expect(buildLessonPrompt(concept, ctx, {})).toBe(buildLessonPrompt(concept, ctx));
  });
});
