// AI provider registry + capability gating (Continuity Part A). Embedding providers are
// registered here; text generation is served by the existing route system (routes.ts), so
// `hasCapability("textGeneration")` is always true. Enabled providers live in localStorage;
// secrets live in the Keychain (`provider:<id>`). A capability with no configured provider
// hides/degrades the feature that needs it — no errors, no dead UI (A5).
import type { AiCapability, AiTaskId } from "../tasks";
import type { EmbeddingProvider } from "./types";
import { BUILTIN_EMBEDDING_PROVIDERS } from "./embeddings";

const embedding = new Map<string, EmbeddingProvider>();
for (const p of BUILTIN_EMBEDDING_PROVIDERS) embedding.set(p.id, p);

const ENABLED_KEY = "ascent-ai-providers"; // JSON string[] of enabled provider ids
const DEFAULT_ENABLED: string[] = []; // embeddings are opt-in (need a cloud key or local Ollama)

function enabledIds(): string[] {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(ENABLED_KEY) : null;
  if (!raw) return DEFAULT_ENABLED;
  try {
    const ids = JSON.parse(raw) as string[];
    return Array.isArray(ids) ? ids : DEFAULT_ENABLED;
  } catch {
    return DEFAULT_ENABLED;
  }
}

export function isAiProviderEnabled(id: string): boolean {
  return enabledIds().includes(id);
}

export function setAiProviderEnabled(id: string, on: boolean): void {
  const next = new Set(enabledIds());
  if (on) next.add(id);
  else next.delete(id);
  localStorage.setItem(ENABLED_KEY, JSON.stringify([...next]));
}

export const aiProviderRegistry = {
  registerEmbedding: (p: EmbeddingProvider) => embedding.set(p.id, p),
  embeddingProviders: (): EmbeddingProvider[] => [...embedding.values()],
  enabledEmbedding: (): EmbeddingProvider[] => [...embedding.values()].filter((p) => isAiProviderEnabled(p.id)),
};

/** Does ANY enabled+configured provider offer this capability? Drives feature gating (A5). */
export function hasCapability(cap: AiCapability): boolean {
  if (cap === "textGeneration") return true; // the route system always provides text
  if (cap === "embeddings") return aiProviderRegistry.enabledEmbedding().length > 0;
  return false; // vision: declared but not implemented
}

/** Resolve an embedding provider + model for a task (B7). v1 returns the first enabled
 *  embedding provider; null when none is configured → the SemanticIndex stays dormant and
 *  cohesion falls back to the canon prereq graph (A5). */
export function getEmbedderFor(_task: AiTaskId): { provider: EmbeddingProvider; modelId: string } | null {
  const [provider] = aiProviderRegistry.enabledEmbedding();
  if (!provider) return null;
  return { provider, modelId: provider.defaultModelId };
}
