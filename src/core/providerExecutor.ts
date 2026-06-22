// The shared JS↔Rust boundary for provider requests (media search/fetch + embeddings).
// A provider adapter (pure TS) builds a descriptor; Rust runs it, injects the named
// Keychain secret (`provider:<id>`), and returns the body — the key never enters JS. This
// is the generic sibling of ai_request/ai_stream; adding a provider needs zero Rust.
import { invoke } from "@tauri-apps/api/core";

/** Structural shape shared by media `RequestDescriptor` and `AiRequestDescriptor`. */
export interface ProviderDescriptor {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  secretAccount?: string;
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
