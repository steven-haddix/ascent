// Typed wrappers for the Rust library blob commands (src-tauri/src/library.rs) —
// the knowledge sibling of providerExecutor.ts. Bytes live in the durable
// app_data_dir blob store; JS sees them only for extraction.
import { invoke } from "@tauri-apps/api/core";

export interface StoredBlob {
  contentHash: string;
  localPath: string;
  mime: string;
  byteSize: number;
  /** the URL that actually served the bytes (after redirects); null for uploads */
  finalUrl: string | null;
}

/** Fetch a public http(s) URL into the blob store (hardened in Rust: scheme,
 *  private-address guard, redirect limit, size cap, MIME sniff). */
export function libraryFetch(url: string): Promise<StoredBlob> {
  return invoke<StoredBlob>("library_fetch", { url });
}

/** Store user-uploaded bytes (webview file input) into the blob store. */
export function libraryStoreBytes(data: string, declaredMime?: string): Promise<StoredBlob> {
  return invoke<StoredBlob>("library_store_bytes", { data, declaredMime: declaredMime ?? null });
}

/** Read a blob back for extraction. */
export async function libraryReadBlob(contentHash: string): Promise<Uint8Array> {
  const b64 = await invoke<string>("library_read_blob", { contentHash });
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Delete a blob once its last DB binding is gone. */
export function libraryDeleteBlob(contentHash: string): Promise<void> {
  return invoke("library_delete_blob", { contentHash });
}
