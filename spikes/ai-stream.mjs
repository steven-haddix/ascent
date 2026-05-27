// Spike 2 (crux): does the Vercel AI SDK consume a CUSTOM fetch and stream text
// incrementally? The custom fetch is the seam where, in the real app, the
// request is routed through Tauri → a Rust command that injects the BYO key
// from the Keychain (no CORS, key never in JS). Here we mock that fetch with a
// faithful Anthropic Messages SSE stream emitted progressively — no API key,
// no network, deterministic.
//
// Run: node spikes/ai-stream.mjs

import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";

const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sse = (event, obj) => `event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`;

// Anthropic Messages streaming events for "Hello, streaming world!" in 3 deltas.
const EVENTS = [
  ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } }],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ", streaming" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world!" } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }],
  ["message_stop", { type: "message_stop" }],
];

const t0 = Date.now();
const arrivals = [];

// This stands in for: AI SDK → Tauri invoke → Rust (reads key from Keychain,
// runs reqwest) → streamed SSE bytes back. The key never touches JS.
const tauriRoutedFetch = async (url, _init) => {
  console.log(`  custom fetch → ${typeof url === "string" ? url : url?.url ?? url}`);
  const body = new ReadableStream({
    async start(controller) {
      for (const [event, obj] of EVENTS) {
        controller.enqueue(enc.encode(sse(event, obj)));
        await sleep(40); // emit progressively to prove incremental delivery
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

async function main() {
  const anthropic = createAnthropic({ apiKey: "sk-fake-not-used", fetch: tauriRoutedFetch });
  const result = streamText({ model: anthropic("claude-sonnet-4-6"), prompt: "Say hello" });

  let assembled = "";
  for await (const delta of result.textStream) {
    const at = Date.now() - t0;
    arrivals.push(at);
    assembled += delta;
    console.log(`  +"${delta}"  @${at}ms`);
  }

  console.log(`\nassembled: "${assembled}"`);
  const incremental = arrivals.length > 1 && arrivals[arrivals.length - 1] - arrivals[0] > 30;
  const ok = assembled === "Hello, streaming world!" && incremental;
  console.log(
    ok
      ? "\nRESULT: PASS — AI SDK consumed a custom (Tauri-routable) fetch and streamed text incrementally"
      : `\nRESULT: FAIL — assembled="${assembled}", incremental=${incremental}, arrivals=${JSON.stringify(arrivals)}`,
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.log(`❌ threw: ${e.stack || e.message}`);
  process.exitCode = 1;
});
