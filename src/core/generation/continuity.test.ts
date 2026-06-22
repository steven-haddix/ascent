// Pure tests for the continuity/handoff section composition (Continuity Engine B4).
// The DB-touching gather (buildContinuitySection) is not unit-tested here; instead we
// guard the hero text directly through the pure formatter formatContinuitySection.
import { describe, expect, it } from "vitest";
import { formatContinuitySection } from "./continuity";
import type { LessonDigest } from "../types";

const digest = (over: Partial<LessonDigest> = {}): LessonDigest => ({
  recap: "what the learner now knows",
  motifs: [],
  notation: [],
  openLoops: [],
  deferredTo: [],
  assumedPrereqs: [],
  ...over,
});

const canon = {
  spine: { arc: "feel the problem, reach for the simplest fix, watch it break, earn each repair" },
  notation: [{ symbol: "η", means: "learning rate" }],
  voice: { tone: "warm", depth: "rigorous", pacing: "gentle" },
};

describe("formatContinuitySection", () => {
  it("returns empty string when there is no canon, no referrer, and no priors", () => {
    expect(
      formatContinuitySection({ canon: null, referrer: null, priors: [] }),
    ).toBe("");
  });

  it("includes the canonical notation block and the symbol when canon notation is present", () => {
    const out = formatContinuitySection({ canon, notation: canon.notation, referrer: null, priors: [] });
    expect(out).toContain("canonical notation");
    expect(out).toContain("η = learning rate");
    expect(out).toContain("Course through-line:");
  });

  it("includes the referrer title and a bridging instruction when a referrer is given", () => {
    const out = formatContinuitySection({
      canon: null,
      referrer: { title: "Gradient Descent", recap: "we minimized loss by stepping downhill" },
      priors: [],
    });
    expect(out).toContain("Gradient Descent");
    expect(out).toContain("bridging");
    expect(out).toContain("we minimized loss by stepping downhill");
  });

  it("falls back to a title-only referrer line when there is no referrer digest", () => {
    const out = formatContinuitySection({
      canon: null,
      referrer: null,
      referrerTitleOnly: "Backprop",
      priors: [],
    });
    expect(out).toContain('arrived here from "Backprop"');
  });

  it("lists each prior by name and the do-not-invent guard when priors are present", () => {
    const out = formatContinuitySection({
      canon: null,
      referrer: null,
      priors: [
        { title: "Loss Functions", digest: digest({ recap: "loss measures how wrong we are" }) },
        {
          title: "Optimization",
          digest: digest({
            recap: "we search parameter space",
            openLoops: ["how to pick the step size"],
            deferredTo: ["Adaptive optimizers"],
          }),
        },
      ],
    });
    expect(out).toContain("NEVER reference or imply a prior lesson that is not listed");
    expect(out).toContain('"Loss Functions": loss measures how wrong we are');
    expect(out).toContain('"Optimization": we search parameter space');
    expect(out).toContain("Open loops it left: how to pick the step size");
    expect(out).toContain("It deferred: Adaptive optimizers");
  });

  it("always includes the CONTINUITY RULES block when the section is non-empty", () => {
    const out = formatContinuitySection({ canon, notation: canon.notation, referrer: null, priors: [] });
    expect(out).toContain("CONTINUITY RULES:");
  });

  it("renders spine neighbours when both are present", () => {
    const out = formatContinuitySection({
      canon,
      spinePrev: "Derivatives",
      spineNext: "Backprop",
      referrer: null,
      priors: [],
    });
    expect(out).toContain('comes after "Derivatives" and leads into "Backprop"');
  });

  it("maps prereq titles into the builds-on line", () => {
    const out = formatContinuitySection({
      canon,
      prereqTitles: ["Vectors", "Dot products"],
      referrer: null,
      priors: [],
    });
    expect(out).toContain("This concept builds on: Vectors, Dot products.");
  });
});
