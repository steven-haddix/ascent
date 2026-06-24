// Search resolution + dispatch (spec §1, §8). getSearcherFor picks the provider; search() runs it,
// routing standalone providers through the generic Rust executor (provider_request) and native
// providers through their model call. Returns null when nothing resolves → grounding/resources stay
// dormant (the feature degrades to off, never errors).
import { providerRequest } from "../providerExecutor";
import { searchProviderRegistry } from "./registry";
import { isNative } from "./types";
import type { AnySearchProvider, SearchQuery, SearchResult } from "./types";

/** Resolve the active searcher: an explicit STANDALONE provider wins; else native; else null.
 *  (Per-task provider preferences are a future nicety — v1 resolves one searcher app-wide.) */
export function getSearcherFor(): AnySearchProvider | null {
  const enabled = searchProviderRegistry.enabled();
  const standalone = enabled.find((p) => !isNative(p));
  if (standalone) return standalone;
  return enabled.find((p) => isNative(p)) ?? null;
}

export interface SearchOutcome {
  providerId: string;
  results: SearchResult[];
}

/** Run a search through the resolved provider. Null when no provider resolves. Throws on a provider
 *  error (the caller — prepareGrounding — fails open). */
export async function search(query: SearchQuery): Promise<SearchOutcome | null> {
  const provider = getSearcherFor();
  if (!provider) return null;
  if (isNative(provider)) {
    return { providerId: provider.id, results: await provider.nativeSearch(query) };
  }
  const res = await providerRequest(provider.buildSearch(query));
  const results = provider.parseSearch(JSON.parse(res.body));
  return { providerId: provider.id, results };
}
