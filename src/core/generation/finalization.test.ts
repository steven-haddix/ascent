// Pure tests for the post-stream finalization pipeline: ordering, per-step
// isolation, and replace-by-name. No DB/AI — the mock steps never touch the
// context, so a minimal fake cast to FinalizationContext is enough.
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerFinalizationStep,
  runFinalization,
  __resetFinalizationSteps,
  type FinalizationContext,
} from "./finalization";

const fctx = {} as unknown as FinalizationContext;

beforeEach(() => {
  __resetFinalizationSteps();
});

describe("runFinalization", () => {
  it("runs steps in ascending order regardless of registration order", async () => {
    const ran: number[] = [];
    registerFinalizationStep({ name: "c", order: 30, run: () => void ran.push(30) });
    registerFinalizationStep({ name: "a", order: 10, run: () => void ran.push(10) });
    registerFinalizationStep({ name: "b", order: 20, run: () => void ran.push(20) });

    await runFinalization(fctx);

    expect(ran).toEqual([10, 20, 30]);
  });

  it("isolates a throwing step so siblings still run and never rejects", async () => {
    const ran: string[] = [];
    registerFinalizationStep({ name: "before", order: 10, run: () => void ran.push("before") });
    registerFinalizationStep({
      name: "boom",
      order: 20,
      run: () => {
        throw new Error("step exploded");
      },
    });
    registerFinalizationStep({ name: "after", order: 30, run: () => void ran.push("after") });

    await expect(runFinalization(fctx)).resolves.toBeUndefined();
    expect(ran).toEqual(["before", "after"]);
  });

  it("registerFinalizationStep replaces by name (latest wins, runs once)", async () => {
    let calls = 0;
    let marker = "";
    registerFinalizationStep({ name: "x", order: 10, run: () => { calls += 1; marker = "first"; } });
    registerFinalizationStep({ name: "x", order: 10, run: () => { calls += 1; marker = "second"; } });

    await runFinalization(fctx);

    expect(calls).toBe(1);
    expect(marker).toBe("second");
  });
});
