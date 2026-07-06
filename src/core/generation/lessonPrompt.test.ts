import { describe, expect, it } from "vitest";
import { buildLessonPrompt, type LessonContext } from "./lessonPrompt";
import type { VisualBrief } from "./visualPlan";

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

  it("injects a non-empty knowledge section after grounding", () => {
    const out = buildLessonPrompt(concept, ctx, { grounding: "GROUNDING_MARKER", knowledge: "KNOWLEDGE_MARKER" });
    expect(out.indexOf("KNOWLEDGE_MARKER")).toBeGreaterThan(out.indexOf("GROUNDING_MARKER"));
  });

  it("injects a visual brief as a learning contract, not a visual-tool whitelist", () => {
    const visualBrief: VisualBrief = {
      visualStance: "Make the learner trace the mechanism before seeing the formula.",
      musts: ["The mechanism needs a visual anchor before code."],
      moments: [
        {
          id: "trace-the-flow",
          label: "Trace the flow",
          learningGoal: "Show how the representation changes shape through the mechanism.",
          suggestedTools: ["figure", "diagram"],
          placement: "before-formalism",
          required: true,
          whyVisual: "The shape change is the concept.",
        },
      ],
      successCriteria: ["A reader can explain the flow by pointing to a visual."],
    };
    const out = buildLessonPrompt(concept, ctx, { visualBrief });
    expect(out).toContain("Visual stance: Make the learner trace the mechanism before seeing the formula.");
    expect(out).toContain("[trace-the-flow] Trace the flow (required)");
    expect(out).toContain("Suggested tools are not a whitelist");
  });

  it("describes domain visual matches as hints rather than routing", () => {
    const out = buildLessonPrompt({ title: "Feed-forward layers", domains: ["programming", "math"] }, ctx);
    expect(out).toContain("VISUAL TOOLKIT");
    expect(out).toContain("not a whitelist");
    expect(out).toContain("VISUAL HINTS");
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
