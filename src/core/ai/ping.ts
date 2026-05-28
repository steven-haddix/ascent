// Console diagnostic: run MINIMAL requests through our exact transport to localize
// a stall. Call window.pingAI() from devtools and watch [ascent:ping].
//   1. non-streaming (ai_request)
//   2. streaming, no schema (ai_stream)
//   3. streaming WITH a tiny Output.object schema — isolates structured output
import { generateText, streamText, Output } from "ai";
import { z } from "zod";
import { getModel } from "./service";
import { dlog } from "../debug";

export async function pingAI(): Promise<void> {
  // 1. Minimal NON-streaming request (the ai_request path).
  const t1 = performance.now();
  dlog("ping", "non-stream → request…");
  try {
    const { text } = await generateText({ model: getModel(), prompt: "Reply with one word: pong." });
    dlog("ping", `non-stream OK @ ${(performance.now() - t1).toFixed(0)}ms:`, text.trim());
  } catch (e) {
    dlog("ping", "non-stream FAILED:", e instanceof Error ? e.message : e);
  }

  // 2. Minimal STREAMING request (the ai_stream path) — no schema.
  const t2 = performance.now();
  dlog("ping", "stream → request…");
  try {
    const r = streamText({ model: getModel(), prompt: "Count from 1 to 5, comma separated." });
    let n = 0;
    for await (const _d of r.textStream) {
      n += 1;
      if (n === 1) dlog("ping", `stream first delta @ ${(performance.now() - t2).toFixed(0)}ms`);
    }
    dlog("ping", `stream done @ ${(performance.now() - t2).toFixed(0)}ms, ${n} deltas`);
  } catch (e) {
    dlog("ping", "stream FAILED:", e instanceof Error ? e.message : e);
  }

  // 3. Minimal STREAMING with a TINY Output.object schema — does structured output
  //    itself hang, or only our large LessonSchema?
  const t3 = performance.now();
  dlog("ping", "stream+schema → request…");
  try {
    const r = streamText({
      model: getModel(),
      output: Output.object({ schema: z.object({ word: z.string(), n: z.number() }) }),
      prompt: 'Return a JSON object with word "pong" and n 5.',
    });
    let n = 0;
    for await (const _p of r.partialOutputStream) {
      n += 1;
      if (n === 1) dlog("ping", `stream+schema first partial @ ${(performance.now() - t3).toFixed(0)}ms`);
    }
    const out = await r.output;
    dlog("ping", `stream+schema done @ ${(performance.now() - t3).toFixed(0)}ms:`, out);
  } catch (e) {
    dlog("ping", "stream+schema FAILED:", e instanceof Error ? e.message : e);
  }
}
