// Built-in embedding providers (Continuity Part A). Each is a PURE-TS adapter: it builds
// a request descriptor and parses the response body. The Rust executor runs the request
// and injects the Keychain secret (`provider:<id>`); the key never enters JS. Adding a
// provider is a module here + a registry.register call — zero Rust.
import type { EmbeddingProvider } from "./types";

/** OpenAI embeddings (cloud, BYO key). */
export const openaiEmbeddings: EmbeddingProvider = {
  id: "openai",
  label: "OpenAI",
  needsKey: true,
  capabilities: ["embeddings"],
  embeddingModels: [
    { id: "text-embedding-3-small", label: "text-embedding-3-small", dim: 1536 },
    { id: "text-embedding-3-large", label: "text-embedding-3-large", dim: 3072 },
  ],
  defaultModelId: "text-embedding-3-small",
  buildEmbed(texts, modelId) {
    return {
      url: "https://api.openai.com/v1/embeddings",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelId, input: texts }),
      secretAccount: "provider:openai",
    };
  },
  parseEmbed(body) {
    const data = (body as { data?: { embedding: number[] }[] })?.data ?? [];
    return data.map((d) => d.embedding);
  },
};

/** Voyage AI embeddings (cloud, BYO key). */
export const voyageEmbeddings: EmbeddingProvider = {
  id: "voyage",
  label: "Voyage AI",
  needsKey: true,
  capabilities: ["embeddings"],
  embeddingModels: [{ id: "voyage-3", label: "voyage-3", dim: 1024 }],
  defaultModelId: "voyage-3",
  buildEmbed(texts, modelId) {
    return {
      url: "https://api.voyageai.com/v1/embeddings",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelId, input: texts }),
      secretAccount: "provider:voyage",
    };
  },
  parseEmbed(body) {
    const data = (body as { data?: { embedding: number[] }[] })?.data ?? [];
    return data.map((d) => d.embedding);
  },
};

/** Ollama local embeddings (keyless; editable base URL, default :11434). Uses the batch
 *  /api/embed endpoint ({model, input: string[]} → {embeddings: number[][]}). */
export const ollamaEmbeddings: EmbeddingProvider = {
  id: "ollama",
  label: "Ollama (local)",
  needsKey: false,
  baseUrl: "http://localhost:11434",
  capabilities: ["embeddings"],
  embeddingModels: [
    { id: "nomic-embed-text", label: "nomic-embed-text", dim: 768 },
    { id: "mxbai-embed-large", label: "mxbai-embed-large", dim: 1024 },
  ],
  defaultModelId: "nomic-embed-text",
  buildEmbed(texts, modelId) {
    const base = (this.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    return {
      url: `${base}/api/embed`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelId, input: texts }),
      // no secretAccount — local, keyless
    };
  },
  parseEmbed(body) {
    return (body as { embeddings?: number[][] })?.embeddings ?? [];
  },
};

export const BUILTIN_EMBEDDING_PROVIDERS: EmbeddingProvider[] = [openaiEmbeddings, voyageEmbeddings, ollamaEmbeddings];
