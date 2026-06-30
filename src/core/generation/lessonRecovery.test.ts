import { describe, expect, it } from "vitest";
import type { PartialLesson } from "./lesson";
import {
  buildLessonContinuationPrompt,
  checkpointFromPartial,
  classifyLessonFailure,
  mergeLessonContinuation,
} from "./lessonRecovery";

describe("checkpointFromPartial", () => {
  it("checkpoints settled blocks but excludes the live tail", () => {
    const checkpoint = checkpointFromPartial({
      subtitle: "A useful frame",
      blocks: [
        { kind: "paragraph", text: "Complete." },
        { kind: "paragraph", text: "Still being writ" },
      ],
    });

    expect(checkpoint.subtitle).toBe("A useful frame");
    expect(checkpoint.blocks).toEqual([{ kind: "paragraph", text: "Complete." }]);
    expect(checkpoint.discardedBlock).toEqual({ kind: "paragraph", text: "Still being writ" });
  });

  it("keeps the final block after a trailing field proves the array closed", () => {
    const partial: PartialLesson = {
      blocks: [{ kind: "paragraph", text: "Complete." }],
      suggestedLessons: [],
    };
    expect(checkpointFromPartial(partial).blocks).toHaveLength(1);
  });

  it("stops at the first closed but unusable block", () => {
    const checkpoint = checkpointFromPartial({
      blocks: [
        { kind: "paragraph", text: "Complete." },
        { kind: "chart", series: [] },
        { kind: "paragraph", text: "Later." },
      ],
      suggestedForks: [],
    });
    expect(checkpoint.blocks).toEqual([{ kind: "paragraph", text: "Complete." }]);
    expect(checkpoint.discardedBlock?.kind).toBe("chart");
  });

  it("never checkpoints beyond the lesson's 14-block contract", () => {
    const blocks = Array.from({ length: 16 }, (_, i) => ({
      kind: "paragraph" as const,
      text: `Block ${i + 1}`,
    }));
    const checkpoint = checkpointFromPartial({ blocks, suggestedLessons: [] });
    expect(checkpoint.blocks).toHaveLength(14);
    expect(checkpoint.discardedBlock).toEqual(blocks[14]);
  });
});

describe("lesson recovery feedback", () => {
  it("appends only new continuation blocks without duplicating the checkpoint", () => {
    const accepted = [
      { kind: "paragraph" as const, text: "Accepted one." },
      { kind: "paragraph" as const, text: "Accepted two." },
    ];
    const merged = mergeLessonContinuation(
      { subtitle: "Saved subtitle", blocks: accepted, discardedBlock: null },
      { blocks: [{ kind: "paragraph", text: "New continuation." }] },
    );
    expect(merged).toEqual({
      subtitle: "Saved subtitle",
      blocks: [...accepted, { kind: "paragraph", text: "New continuation." }],
      suggestedLessons: undefined,
      suggestedForks: undefined,
    });
  });

  it("distinguishes interruption from content failure", () => {
    const failure = classifyLessonFailure(new Error("connection reset"));
    expect(failure.kind).toBe("provider");
    expect(failure.recoveryHint).toContain("do not treat accepted content as incorrect");
  });

  it("includes accepted content, discarded context, and the prior error", () => {
    const prompt = buildLessonContinuationPrompt(
      "original instructions",
      {
        subtitle: "Frame",
        blocks: [{ kind: "paragraph", text: "Accepted." }],
        discardedBlock: { kind: "chart", title: "Broken chart" },
      },
      "series[0].points[2].y must be a number",
    );
    expect(prompt).toContain("1 block(s)");
    expect(prompt).toContain("Accepted.");
    expect(prompt).toContain("Broken chart");
    expect(prompt).toContain("must be a number");
    expect(prompt).toContain("Do not repeat");
  });
});
