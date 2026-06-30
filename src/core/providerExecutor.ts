// The shared JS↔Rust boundary for provider requests (media search/fetch + embeddings).
// A provider adapter (pure TS) builds a descriptor; Rust runs it, injects the named
// Keychain secret (`provider:<id>`), and returns the body — the key never enters JS. This
// is the generic sibling of ai_request/ai_stream; adding a provider needs zero Rust.
import { invoke } from "@tauri-apps/api/core";

/** How Rust injects the Keychain secret for a descriptor (spec §3). Absent = `bearer`, i.e. the
 *  current behavior (Authorization: Bearer <key>), so existing media/embeddings descriptors are
 *  unchanged. `header` sets an arbitrary header (e.g. X-Subscription-Token); `query` appends a URL
 *  query param (e.g. ?api_key=<key>). */
export interface ProviderAuth {
  scheme: "bearer" | "header" | "query";
  /** header name or query-param key (required for `header`/`query`). */
  name?: string;
}

/** Structural shape shared by media `RequestDescriptor`, `AiRequestDescriptor`, and search. */
export interface ProviderDescriptor {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  secretAccount?: string;
  /** secret injection scheme (spec §3); absent = bearer. */
  auth?: ProviderAuth;
  /** per-request timeout in ms (spec §3); absent = no extra timeout (only the client connect-timeout). */
  timeoutMs?: number;
}

export interface ProviderResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface DownloadedAsset {
  localPath: string;
  contentType: string;
  width?: number;
  height?: number;
}

/** Run a JSON request descriptor in Rust (search / embeddings / generate). */
export function providerRequest(descriptor: ProviderDescriptor): Promise<ProviderResponse> {
  return invoke<ProviderResponse>("provider_request", { descriptor });
}

/** Download a provider asset's bytes to the local media cache dir (never into JS). */
export function providerDownload(descriptor: ProviderDescriptor): Promise<DownloadedAsset> {
  return invoke<DownloadedAsset>("provider_download", { descriptor });
}

/** Persist base64 image bytes returned inside a JSON generation response. Keeping
 *  the decode/write in Rust avoids data URLs and gives every renderer a local path. */
export function cacheGeneratedAsset(data: string, contentType: string, cacheKey: string): Promise<DownloadedAsset> {
  return invoke<DownloadedAsset>("cache_generated_asset", { data, contentType, cacheKey });
}
