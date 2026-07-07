import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { hasCapability, getEmbedderFor, setAiProviderEnabled, aiProviderRegistry } from "./registry";
import { openaiEmbeddings, ollamaEmbeddings } from "./embeddings";

function stubLocalStorage() {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe("AI capability gating", () => {
  beforeEach(stubLocalStorage);
  afterEach(() => {
    // @ts-expect-error reset
    delete globalThis.localStorage;
  });

  it("textGeneration is always available (route system)", () => {
    expect(hasCapability("textGeneration")).toBe(true);
  });

  it("embeddings is dormant until a provider is enabled", () => {
    expect(hasCapability("embeddings")).toBe(false);
    expect(getEmbedderFor("embed")).toBeNull();
    setAiProviderEnabled("ollama", true);
    expect(hasCapability("embeddings")).toBe(true);
    const e = getEmbedderFor("embed");
    expect(e?.provider.id).toBe("ollama");
    expect(e?.modelId).toBe("nomic-embed-text");
  });

  it("vision is available through a route model", () => {
    expect(hasCapability("vision")).toBe(true);
  });

  it("registry lists the built-in embedding providers", () => {
    expect(aiProviderRegistry.embeddingProviders().map((p) => p.id)).toContain("openai");
  });
});

describe("embedding adapters", () => {
  it("openai buildEmbed → descriptor with bearer secret account; parseEmbed → vectors", () => {
    const d = openaiEmbeddings.buildEmbed(["a", "b"], "text-embedding-3-small");
    expect(d.url).toContain("api.openai.com");
    expect(d.secretAccount).toBe("provider:openai");
    expect(JSON.parse(d.body!).input).toEqual(["a", "b"]);
    const vecs = openaiEmbeddings.parseEmbed({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3] }] });
    expect(vecs).toEqual([[0.1, 0.2], [0.3]]);
  });

  it("ollama is keyless and parses the batch /api/embed shape", () => {
    const d = ollamaEmbeddings.buildEmbed(["x"], "nomic-embed-text");
    expect(d.url).toContain("11434/api/embed");
    expect(d.secretAccount).toBeUndefined();
    expect(ollamaEmbeddings.parseEmbed({ embeddings: [[1, 2, 3]] })).toEqual([[1, 2, 3]]);
  });
});
