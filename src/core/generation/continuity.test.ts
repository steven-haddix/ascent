// Pure tests for the continuity/handoff section composition (Continuity Engine B4).
// The DB-touching gather (buildContinuitySection) is not unit-tested here; instead we
// guard the hero text directly through the pure formatter formatContinuitySection.
import { describe, expect, it } from "vitest";
import { formatContinuitySection, isUpstreamConcept, isDescendantConcept } from "./continuity";
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

  it("frames the topic root as the opening lesson, not a continuation", () => {
    const out = formatContinuitySection({ canon, notation: canon.notation, referrer: null, priors: [], isTopicRoot: true });
    expect(out).toContain("OPENING lesson of the whole topic");
    expect(out).toContain("OPENS A CONTINUOUS COURSE");
    expect(out).toContain("introduce and motivate the subject from the start");
    // and it must NOT inherit the "build on what came before" / "connect to where the learner came from" framing
    expect(out).not.toContain("build on what came before");
    expect(out).not.toContain("connecting to where the learner came from");
  });

  it("carries the root framing even when there is no canon", () => {
    const out = formatContinuitySection({ canon: null, referrer: null, priors: [], isTopicRoot: true });
    expect(out).toContain("OPENING lesson of the whole topic");
    expect(out).toContain("CONTINUITY RULES:");
  });
});

describe("isUpstreamConcept", () => {
  // tree: root → [a, b]; a → [a1]. spine order: root, a, a1, b.
  const parentById = new Map<string, string | null>([
    ["root", null],
    ["a", "root"],
    ["a1", "a"],
    ["b", "root"],
  ]);
  const spineOrder = ["root", "a", "a1", "b"];
  const up = (candidateId: string, conceptId: string, prereqIds: string[] = []) =>
    isUpstreamConcept({ candidateId, conceptId, parentById, spineOrder, prereqIds });

  it("treats an ancestor as upstream", () => {
    expect(up("root", "a")).toBe(true);
    expect(up("a", "a1")).toBe(true);
  });

  it("treats a descendant as downstream (NOT upstream) — the root-regeneration bug", () => {
    expect(up("a", "root")).toBe(false); // child is not 'prior' to its parent
    expect(up("a1", "root")).toBe(false); // grandchild either
  });

  it("uses spine order for lateral concepts", () => {
    expect(up("a", "b")).toBe(true); // a precedes b on the spine
    expect(up("b", "a")).toBe(false); // b comes after a
  });

  it("honors an explicit prereq regardless of spine position", () => {
    expect(up("b", "a", ["b"])).toBe(true); // b declared a prereq of a → upstream
  });

  it("never marks the concept itself upstream", () => {
    expect(up("a", "a")).toBe(false);
  });

  it("is indeterminate (false) when neither lineage nor spine can order the pair", () => {
    expect(up("x", "a")).toBe(false); // x is off-tree and off-spine
  });

  it("does not let a later clicked concept become title-only prior context", () => {
    const referrerId = "b";
    const conceptId = "a";
    const referrerIsUsable = up(referrerId, conceptId);
    const out = formatContinuitySection({
      canon,
      referrer: referrerIsUsable ? { title: "Later Topic", recap: "should not appear" } : null,
      priors: [],
    });
    expect(referrerIsUsable).toBe(false);
    expect(out).not.toContain("Later Topic");
    expect(out).not.toContain("arrived here from");
  });

  it("isDescendantConcept detects descendants only", () => {
    expect(isDescendantConcept("a", "root", parentById)).toBe(true);
    expect(isDescendantConcept("a1", "root", parentById)).toBe(true);
    expect(isDescendantConcept("root", "a", parentById)).toBe(false);
    expect(isDescendantConcept("b", "a", parentById)).toBe(false);
  });
});
