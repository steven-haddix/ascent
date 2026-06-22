import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildLessonSchema, BASE_BLOCK_KINDS } from "./lessonSchema";

// A known-good lesson exercising several block kinds the default schema supports.
const knownGoodLesson = {
  subtitle: "How iterative steps minimize a loss",
  blocks: [
    { kind: "paragraph", text: "Imagine rolling downhill toward the lowest point.", terms: [{ term: "downhill", gloss: "negative gradient direction" }] },
    { kind: "section", label: "The mechanism", hint: "one step at a time" },
    { kind: "code", language: "python", title: "One gradient step", text: "x -= lr * grad(x)" },
    {
      kind: "chart",
      chartType: "line",
      series: [{ name: "loss", points: [{ x: "0", y: 1 }, { x: "1", y: 0.4 }] }],
      xLabel: "step",
      yLabel: "loss",
    },
    { kind: "table", title: "Methods", headers: ["name", "uses gradient"], rows: [["GD", "yes"], ["Newton", "yes"]] },
    { kind: "math", text: "x_{t+1} = x_t - \\eta \\nabla f(x_t)" },
    { kind: "widget", widgetId: "lr-slider", title: "Learning rate slider", spec: "Drag the learning rate from 0.01 to 1 and watch the path converge or diverge." },
  ],
  suggestedLessons: [{ handle: "c1", reason: "prerequisite" }],
  suggestedForks: [{ title: "Stochastic GD", reason: "a natural next branch" }],
};

describe("buildLessonSchema", () => {
  it("parses a known-good lesson with several block kinds", () => {
    const result = buildLessonSchema().safeParse(knownGoodLesson);
    expect(result.success).toBe(true);
  });

  it("accepts every BASE_BLOCK_KIND as a valid kind enum value", () => {
    const schema = buildLessonSchema();
    for (const kind of BASE_BLOCK_KINDS) {
      const lesson = {
        subtitle: "s",
        blocks: [{ kind, text: "x", label: "x", widgetId: "w", title: "t", spec: "do a thing the learner controls" }],
        suggestedLessons: [],
        suggestedForks: [],
      };
      expect(schema.safeParse(lesson).success).toBe(true);
    }
  });

  it("rejects an unknown block kind by default", () => {
    const lesson = {
      subtitle: "s",
      blocks: [{ kind: "timeline", text: "x" }],
      suggestedLessons: [],
      suggestedForks: [],
    };
    expect(buildLessonSchema().safeParse(lesson).success).toBe(false);
  });

  it("a fragment adds a new kind + fields that the default schema rejects", () => {
    const withTimeline = buildLessonSchema([{ kinds: ["timeline"], shape: { events: z.array(z.any()).optional() } }]);
    const lesson = {
      subtitle: "s",
      blocks: [{ kind: "timeline", events: [{ year: 1900, label: "x" }] }],
      suggestedLessons: [],
      suggestedForks: [],
    };
    expect(withTimeline.safeParse(lesson).success).toBe(true);
    expect(buildLessonSchema().safeParse(lesson).success).toBe(false);
  });
});
