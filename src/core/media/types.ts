// Media provider system — content-agnostic from day one (Visual Learning System §6).
// `image` is the first MediaKind; the convention scales to video / embeds / generated
// images / audio across many configurable providers. A provider adapter is PURE
// TypeScript: it BUILDS request descriptors and PARSES response bodies. It performs no
// network I/O — the Rust executor runs the request and injects the Keychain secret, so
// keys never enter JS and adding a provider is a pure-TS module with zero Rust changes.

export type MediaKind = "image" | "video" | "embed" | "generated-image" | "audio";

export interface MediaQuery {
  kind: MediaKind;
  query: string;
  filters?: Record<string, string>;
}

export interface License {
  id: string;
  name: string;
  url?: string;
  requiresAttribution: boolean;
}

export interface Attribution {
  author?: string;
  sourceUrl: string;
  title?: string;
}

// Kind-specific payloads — a discriminated union, NOT one baggy shape.
export interface ImagePayload {
  kind: "image";
  url: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
}
export interface EmbedPayload {
  kind: "embed";
  html?: string;
  iframeUrl?: string;
}
export interface GeneratedPayload {
  kind: "generated-image";
  url: string;
}
export interface AudioPayload {
  kind: "audio";
  url: string;
}
export type MediaPayload = ImagePayload | EmbedPayload | GeneratedPayload | AudioPayload;

export interface MediaResult {
  kind: MediaKind;
  providerId: string;
  payload: MediaPayload;
  license: License;
  attribution: Attribution;
}

// A provider DESCRIBES a request; it never performs network I/O itself. The Rust
// executor (media.rs) runs it and injects the named Keychain secret (`provider:<id>`).
export interface RequestDescriptor {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  /** names the Keychain secret Rust injects (provider:<id>) — never in JS */
  secretAccount?: string;
}

/** A descriptor for an embeddable asset (oEmbed/iframe), rendered sandboxed (§6e). */
export interface EmbedDescriptor {
  iframeUrl?: string;
  html?: string;
}

export interface GenerateOpts {
  size?: string;
  n?: number;
}

// Base metadata every provider has.
export interface MediaProviderMeta {
  id: string; // "wikimedia" | "openverse" | "youtube" | "met" | ...
  label: string;
  kinds: MediaKind[];
  needsKey: boolean; // → Keychain secret under `provider:<id>`
  licenseDefault?: string;
}

// Capabilities are SEPARATE interfaces — a provider implements only what it does,
// avoiding a lowest-common-denominator shape across Wikimedia / YouTube / generators.
export interface SearchableMediaProvider extends MediaProviderMeta {
  buildSearch(q: MediaQuery): RequestDescriptor;
  parseSearch(body: unknown): MediaResult[];
  buildFetch(r: MediaResult): RequestDescriptor; // resolve the chosen asset's bytes
}
export interface GenerativeMediaProvider extends MediaProviderMeta {
  buildGenerate(prompt: string, opts: GenerateOpts): RequestDescriptor;
  parseGenerate(body: unknown): MediaResult;
}
export interface EmbeddableMediaProvider extends MediaProviderMeta {
  buildEmbed(r: MediaResult): EmbedDescriptor;
}

export type AnyMediaProvider =
  | SearchableMediaProvider
  | GenerativeMediaProvider
  | EmbeddableMediaProvider
  | MediaProviderMeta;

export function isSearchable(p: MediaProviderMeta): p is SearchableMediaProvider {
  return typeof (p as SearchableMediaProvider).buildSearch === "function";
}
export function isGenerative(p: MediaProviderMeta): p is GenerativeMediaProvider {
  return typeof (p as GenerativeMediaProvider).buildGenerate === "function";
}
