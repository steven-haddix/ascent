// Tavily — the v1 reference STANDALONE search provider (spec §10). Pure TypeScript: it builds a
// request descriptor and parses the JSON the Rust executor returns. Tavily uses `Authorization:
// Bearer` auth, which is the executor's DEFAULT injection — so it works with ZERO Rust auth change
// (Brave/Exa, which need header/query schemes, exercise the §3 generalization later). The key is
// stored in the Keychain under `provider:tavily` and injected in Rust; it never enters JS.
import type { SearchQuery, SearchResult, StandaloneSearchProvider } from "../types";
import { domainOf, httpUrlOrNull, inferKind } from "../types";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}
interface TavilyResponse {
  results?: TavilyResult[];
}

export const tavily: StandaloneSearchProvider = {
  id: "tavily",
  label: "Tavily",
  needsKey: true,

  buildSearch(q: SearchQuery) {
    return {
      url: "https://api.tavily.com/search",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: q.query,
        max_results: q.topK ?? 5,
        search_depth: "basic",
        topic: q.freshness === "recent" ? "news" : "general",
      }),
      secretAccount: "provider:tavily",
      // auth omitted → executor default (Authorization: Bearer <key>), which is what Tavily wants.
      timeoutMs: 8000, // bound the HTTP request in Rust so a hung request can't stall the job
    };
  },

  parseSearch(body: unknown): SearchResult[] {
    const results = (body as TavilyResponse)?.results ?? [];
    const out: SearchResult[] = [];
    for (const r of results) {
      const url = httpUrlOrNull(r.url);
      if (!url) continue; // safety §9: http(s) only
      out.push({
        title: r.title?.trim() || url,
        url,
        snippet: (r.content ?? "").replace(/\s+/g, " ").trim(),
        source: domainOf(url),
        kind: inferKind(url),
        publishedAt: r.published_date,
        score: typeof r.score === "number" ? r.score : undefined,
      });
    }
    return out;
  },
};
