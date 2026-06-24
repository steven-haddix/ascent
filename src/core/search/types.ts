// Web Search capability — types (spec docs/superpowers/specs/2026-06-23-web-search-design.md
// §1–§2). A search provider returns SearchResult[] behind ONE contract; standalone providers
// build an HTTP descriptor for the generic Rust executor, native providers conform via a
// search-only model call. This is the THIRD instance of the provider+capability pattern (after
// embeddings + media) and — like media — lives in its OWN registry, NOT in AiCapability (which
// means *model* capability). Output is symmetric; mechanism is deliberately not.
import type { ProviderDescriptor } from "../providerExecutor";

export type SearchKind = "web" | "paper" | "video" | "blog" | "docs";

export interface SearchQuery {
  query: string;
  /** how many results to keep (default 5). */
  topK?: number;
  freshness?: "any" | "recent";
}

export interface SearchResult {
  title: string;
  url: string; // http(s) only — enforced at parse time
  snippet: string; // untrusted text — treated as DATA, never instructions
  source?: string; // domain / publisher
  kind: SearchKind; // inferred from URL/domain
  publishedAt?: string;
  score?: number;
}

export interface SearchProviderMeta {
  id: string; // "tavily" | "anthropic-native" | ...
  label: string;
  needsKey: boolean; // false for native (rides the route's already-Rust-managed LLM key)
}

/** Standalone: PURE-TS, no I/O. descriptor → provider_request (Rust) → parse. */
export interface StandaloneSearchProvider extends SearchProviderMeta {
  buildSearch(q: SearchQuery): ProviderDescriptor;
  parseSearch(body: unknown): SearchResult[];
}

/** Native: owns a generateText call (the spike-validated path). Same OUTPUT, different mechanism. */
export interface NativeSearchProvider extends SearchProviderMeta {
  nativeSearch(q: SearchQuery): Promise<SearchResult[]>;
  /** whether the active AI route actually supports native search right now (cheap check). */
  isAvailable(): boolean;
}

export type AnySearchProvider = StandaloneSearchProvider | NativeSearchProvider;

export function isStandalone(p: SearchProviderMeta): p is StandaloneSearchProvider {
  return typeof (p as StandaloneSearchProvider).buildSearch === "function";
}
export function isNative(p: SearchProviderMeta): p is NativeSearchProvider {
  return typeof (p as NativeSearchProvider).nativeSearch === "function";
}

// --- small URL helpers (safety §9 + kind inference §2), shared by all providers ---

/** Returns the normalized http(s) URL, or null for anything else (drops javascript:/data:/mailto:…). */
export function httpUrlOrNull(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Bare hostname (www-stripped) for display + provenance. */
export function domainOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Cheap kind inference from the URL so the resources panel can group Papers/Videos/Blogs/Docs. */
export function inferKind(url: string): SearchKind {
  const u = url.toLowerCase();
  if (/(arxiv\.org|doi\.org|aclanthology|semanticscholar|researchgate|biorxiv|ssrn|nature\.com|ieee|acm\.org)/.test(u) || /\.pdf($|\?)/.test(u))
    return "paper";
  if (/(youtube\.com|youtu\.be|vimeo\.com)/.test(u)) return "video";
  if (/(docs\.|developer\.|readthedocs|wikipedia\.org|\/wiki\/|mdn|developer\.mozilla)/.test(u)) return "docs";
  if (/(medium\.com|substack\.com|^https?:\/\/blog\.|\.blog($|\/)|dev\.to|hashnode)/.test(u)) return "blog";
  return "web";
}
