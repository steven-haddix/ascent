// Anthropic native web search — the keyless DEFAULT searcher (spec §4). It rides the active AI
// route (so the call goes through Rust ai_request; the key stays in the Keychain), and conforms to
// the SearchProvider contract via a dedicated search-only generateText call.
//
// SPIKE-VALIDATED shape (spikes/native-web-search.ts, 2026-06-23): the web_search server tool +
// structured output returns usable {title,url,snippet}[] — but ONLY without a forced toolChoice
// (forcing yields AI_NoObjectGeneratedError). `result.sources` carries url+title but NOT excerpt
// text, so the model writes the snippet itself via the structured schema. maxUses is capped in
// getNativeSearch to bound cost (search content inflates input tokens).
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import { getNativeSearch, isNativeSearchAvailable } from "../../ai/service";
import { dlog } from "../../debug";
import type { NativeSearchProvider, SearchQuery, SearchResult } from "../types";
import { domainOf, httpUrlOrNull, inferKind } from "../types";

const NATIVE_TASK = "websearch" as const;

const Digest = z.object({
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string().describe("1-2 sentences, in your own words, on what this source says"),
      }),
    )
    .describe("the web sources you consulted, most relevant first"),
});

export const anthropicNative: NativeSearchProvider = {
  id: "anthropic-native",
  label: "Anthropic (web search)",
  needsKey: false,

  isAvailable: () => isNativeSearchAvailable(NATIVE_TASK),

  async nativeSearch(q: SearchQuery): Promise<SearchResult[]> {
    const ns = getNativeSearch(NATIVE_TASK);
    if (!ns) return [];
    const topK = q.topK ?? 5;
    const { output } = await generateText({
      model: ns.model,
      tools: { web_search: ns.tool },
      stopWhen: stepCountIs(4),
      output: Output.object({ schema: Digest }),
      // NO toolChoice — forcing the tool breaks structured output (spike finding §4).
      prompt: `Search the web for current, authoritative sources on: ${q.query}
Return the ${topK} most relevant sources as JSON. For each give its exact title, URL, and a 1-2 sentence
snippet in your own words of what it says. Prefer recent, primary sources (papers, official docs,
reputable blogs, talks). Do not invent URLs — only include sources you actually found.`,
    });

    const rows = (output?.results ?? []) as { title: string; url: string; snippet: string }[];
    const out: SearchResult[] = [];
    for (const r of rows) {
      const url = httpUrlOrNull(r.url);
      if (!url) continue;
      out.push({
        title: r.title?.trim() || url,
        url,
        snippet: (r.snippet ?? "").replace(/\s+/g, " ").trim(),
        source: domainOf(url),
        kind: inferKind(url),
      });
    }
    dlog("search", "native returned", out.length, "results");
    return out.slice(0, topK);
  },
};
