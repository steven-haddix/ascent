import { describe, expect, it } from "vitest";
import { renderVisualBriefForPrompt, visualToolkitPrompt, type VisualBrief } from "./visualPlan";

describe("visual plan prompt helpers", () => {
  it("lists the full toolkit while treating domain matches as hints", () => {
    const out = visualToolkitPrompt(["programming", "math"]);
    expect(out).toContain("VISUAL TOOLKIT");
    expect(out).toContain("Catalog hints");
    expect(out).toContain("not a whitelist");
    expect(out).toContain("- map:");
    expect(out).toContain("- widget:");
    expect(out).toContain("- generated-image:");
    expect(out).toContain("Generated illustrations are not configured");
  });

  it("renders fallback visual contract without static routing", () => {
    const out = renderVisualBriefForPrompt(null);
    expect(out).toContain("Use any supported visual tool");
    expect(out).toContain("domain hints are not limits");
  });

  it("renders required moments while keeping tools substitutable", () => {
    const brief: VisualBrief = {
      visualStance: "Let the learner compare dense and sparse paths visually.",
      musts: ["Show the branching path tokens can take."],
      moments: [
        {
          id: "routing-path",
          label: "Routing path",
          learningGoal: "Trace one token from input through its selected experts.",
          suggestedTools: ["diagram", "widget"],
          placement: "mechanism",
          required: true,
          whyVisual: "Routing is a path, not just a formula.",
        },
      ],
      successCriteria: ["The token path is visible."],
    };
    const out = renderVisualBriefForPrompt(brief);
    expect(out).toContain("Routing path (required)");
    expect(out).toContain("Suggested tools: diagram, widget");
    expect(out).toContain("Suggested tools are not a whitelist");
  });
});
