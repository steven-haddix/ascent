// Console diagnostic: run a MINIMAL request (no schema) through our exact transport
// to isolate "is the transport/API reachable at all?" from "is the complex lesson
// request the problem?". Call window.pingAI() from devtools and watch [ascent:ping].
import { generateText, streamText } from "ai";
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

  // 2. Minimal STREAMING request (the ai_stream path) — no Output.object schema.
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
}
