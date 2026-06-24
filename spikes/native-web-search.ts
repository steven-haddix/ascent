// SPIKE (not shipped) — validates the native-search-only call the web-search spec
// (§4) gates implementation on: does Anthropic's `webSearch_20250305` server tool
// compose with (a) AI SDK structured output and (b) a FORCED toolChoice, and does it
// return usable {title,url,snippet}[] plus a knowable cost?
//
// Run: ANTHROPIC_API_KEY="$(security find-generic-password -s ascent -a anthropic-api-key -w)" \
//      bun spikes/native-web-search.ts
//
// Three variants isolate the risk:
//   V1  web_search + structured output, NO forced toolChoice   (the spec's primary path)
//   V2  V1 + toolChoice forced to web_search                    (does forcing conflict?)
//   V3  web_search only, read result.sources / result.text      (baseline: what do sources carry?)
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error("NO_KEY — set ANTHROPIC_API_KEY (see header for the keychain one-liner).");
  process.exit(2);
}

// Pin baseURL: this shell exports ANTHROPIC_BASE_URL without /v1 (for Claude Code), which the
// SDK would otherwise inherit and 404 on. The GUI app never sees that env, so prod is unaffected.
const anthropic = createAnthropic({ apiKey: KEY, baseURL: "https://api.anthropic.com/v1" });
const MODEL = "claude-haiku-4-5-20251001"; // the model the `websearch` task would default to (MODELS.fast)

// What `prepareGrounding` wants back: the sources the model consulted, each with a
// model-written snippet (since result.sources carries url+title but not excerpt text).
const Digest = z.object({
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string().describe("1-2 sentences, in your own words, on what this source says"),
      }),
    )
    .describe("the web sources you consulted to answer, most relevant first"),
});

const QUERY =
  "What are the most recent (2026) techniques for extending the context length of large language models? Cite the sources you find.";

// Haiku list rates (routes.ts) + Anthropic web search billing ($10 / 1,000 searches = $0.01 each).
const RATE_IN = 1 / 1_000_000;
const RATE_OUT = 5 / 1_000_000;
const RATE_SEARCH = 0.01;

function webSearchRequests(pm: unknown): number | null {
  // Anthropic reports server tool usage in providerMetadata; shape not guaranteed, so probe loosely.
  try {
    const a = (pm as any)?.anthropic;
    const candidates = [
      a?.usage?.serverToolUse?.webSearchRequests,
      a?.usage?.server_tool_use?.web_search_requests,
      a?.serverToolUse?.webSearchRequests,
    ];
    for (const c of candidates) if (typeof c === "number") return c;
  } catch {
    /* ignore */
  }
  return null;
}

function estCost(usage: any, searches: number | null): string {
  const inTok = usage?.inputTokens ?? usage?.promptTokens ?? 0;
  const outTok = usage?.outputTokens ?? usage?.completionTokens ?? 0;
  const s = searches ?? 0;
  const usd = inTok * RATE_IN + outTok * RATE_OUT + s * RATE_SEARCH;
  return `~$${usd.toFixed(4)} (in ${inTok} tok, out ${outTok} tok, ${searches ?? "?"} searches)`;
}

function summarizeSources(sources: any[] | undefined) {
  if (!sources?.length) return "  sources: none";
  return (
    `  sources: ${sources.length}\n` +
    sources
      .slice(0, 3)
      .map((s, i) => `    [${i}] type=${s.sourceType ?? s.type} title=${JSON.stringify(s.title)} url=${s.url}`)
      .join("\n")
  );
}

async function run(
  label: string,
  fn: () => Promise<any>,
): Promise<void> {
  const t0 = Date.now();
  console.log(`\n${"=".repeat(70)}\n${label}\n${"=".repeat(70)}`);
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    const searches = webSearchRequests(r.providerMetadata);
    console.log(`OK in ${ms}ms`);
    console.log(`  toolCalls=${r.toolCalls?.length ?? 0} toolResults=${r.toolResults?.length ?? 0} steps=${r.steps?.length ?? "?"}`);
    console.log(summarizeSources(r.sources));
    console.log(`  cost ${estCost(r.usage, searches)}`);
    // Structured output (V1/V2)
    const out = (r as any).output ?? (r as any).experimental_output;
    if (out?.results) {
      console.log(`  STRUCTURED OUTPUT: ${out.results.length} results`);
      out.results.slice(0, 3).forEach((x: any, i: number) =>
        console.log(`    [${i}] ${JSON.stringify(x.title)}\n        url=${x.url}\n        snippet(${x.snippet?.length ?? 0} ch)=${JSON.stringify((x.snippet ?? "").slice(0, 160))}`),
      );
      const withSnippet = out.results.filter((x: any) => (x.snippet ?? "").trim().length > 20).length;
      console.log(`  >>> ${withSnippet}/${out.results.length} results have a usable (>20 ch) snippet`);
    } else if (label.startsWith("V3")) {
      console.log(`  TEXT (${r.text?.length ?? 0} ch): ${JSON.stringify((r.text ?? "").slice(0, 200))}`);
    } else {
      console.log("  STRUCTURED OUTPUT: <<< MISSING — output did not parse to {results:[]} >>>");
    }
  } catch (err: any) {
    console.log(`ERROR after ${Date.now() - t0}ms`);
    console.log(`  ${err?.name}: ${err?.message}`);
    if (err?.cause?.message) console.log(`  cause: ${err.cause.message}`);
  }
}

const webSearch = anthropic.tools.webSearch_20250305({ maxUses: 4 });

await run("V1 — web_search + structured output, NO forced toolChoice", () =>
  generateText({
    model: anthropic(MODEL),
    prompt: QUERY,
    tools: { web_search: webSearch },
    stopWhen: stepCountIs(6),
    output: Output.object({ schema: Digest }),
  }),
);

await run("V2 — V1 + toolChoice forced to web_search", () =>
  generateText({
    model: anthropic(MODEL),
    prompt: QUERY,
    tools: { web_search: webSearch },
    toolChoice: { type: "tool", toolName: "web_search" },
    stopWhen: stepCountIs(6),
    output: Output.object({ schema: Digest }),
  }),
);

await run("V3 — web_search only (baseline), read result.sources + result.text", () =>
  generateText({
    model: anthropic(MODEL),
    prompt: QUERY,
    tools: { web_search: webSearch },
    stopWhen: stepCountIs(6),
  }),
);

console.log(`\n${"=".repeat(70)}\nDONE\n${"=".repeat(70)}`);
