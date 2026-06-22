// AI Provider & Capability Registry — types (Continuity Engine Part A). A provider is an
// AI backend declaring the capabilities it supports. Features gate on CAPABILITIES, not
// providers: a feature lights up only if some configured provider can do what it needs.
//
// Text generation keeps flowing through the existing route system (routes.ts + the AI SDK
// + Rust ai_request/ai_stream). Embeddings are the new capability: they flow through the
// generic descriptor → Rust executor, so a provider adapter is pure TS and adding one is
// zero Rust. The descriptor shape mirrors the media system's exactly (one Rust executor).
import type { AiCapability } from "../tasks";

export interface AiRequestDescriptor {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  /** names the Keychain secret Rust injects (`provider:<id>`) — never in JS */
  secretAccount?: string;
}

export interface AiProviderMeta {
  id: string; // "openai" | "google" | "voyage" | "ollama" | ...
  label: string;
  needsKey: boolean; // false for local (Ollama) → no Keychain secret
  baseUrl?: string; // configurable for local/self-hosted (Ollama default :11434)
  capabilities: AiCapability[];
}

export interface EmbeddingModelInfo {
  id: string;
  label: string;
  /** output dimensionality (for sqlite-vec table sizing) */
  dim: number;
}

// Capabilities are SEPARATE interfaces — a provider implements only what it does.
export interface EmbeddingProvider extends AiProviderMeta {
  embeddingModels: EmbeddingModelInfo[];
  defaultModelId: string;
  /** pure-TS: build the request descriptor; Rust runs it + injects the key */
  buildEmbed(texts: string[], modelId: string): AiRequestDescriptor;
  /** pure-TS: parse the provider's response body into row-aligned vectors */
  parseEmbed(body: unknown): number[][];
}
