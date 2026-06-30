import type { GenerativeMediaProvider, MediaResult, RequestDescriptor } from "../types";

const OPENAI_IMAGE_API = "https://api.openai.com/v1/images/generations";

interface OpenAIImageResponse {
  data?: { b64_json?: string }[];
  error?: { message?: string };
}

export const openaiImages: GenerativeMediaProvider = {
  id: "openai-images",
  label: "OpenAI Images",
  kinds: ["generated-image"],
  needsKey: true,

  buildGenerate(prompt, opts): RequestDescriptor {
    return {
      url: OPENAI_IMAGE_API,
      method: "POST",
      headers: { "content-type": "application/json" },
      secretAccount: "provider:openai-images",
      timeoutMs: 150_000,
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt,
        n: Math.max(1, Math.min(opts.n ?? 1, 4)),
        size: opts.size ?? "1536x864",
        quality: opts.quality ?? "medium",
        output_format: "jpeg",
      }),
    };
  },

  parseGenerate(body: unknown): MediaResult {
    const parsed = body as OpenAIImageResponse;
    const data = parsed?.data?.[0]?.b64_json;
    if (!data) throw new Error(parsed?.error?.message || "OpenAI returned no generated image");
    return {
      kind: "generated-image",
      providerId: "openai-images",
      payload: { kind: "generated-image", data, mimeType: "image/jpeg" },
      license: { id: "ai-generated", name: "AI-generated", requiresAttribution: false },
      attribution: {
        author: "OpenAI",
        sourceUrl: "https://developers.openai.com/api/docs/guides/image-generation",
      },
    };
  },
};
