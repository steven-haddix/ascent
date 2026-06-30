import type { GenerativeMediaProvider, MediaResult, RequestDescriptor } from "../types";

const GEMINI_INTERACTIONS_API = "https://generativelanguage.googleapis.com/v1beta/interactions";

interface GeminiImageResponse {
  output_image?: { data?: string; mime_type?: string };
  error?: { message?: string };
}

export const geminiImages: GenerativeMediaProvider = {
  id: "gemini-images",
  label: "Gemini Images",
  kinds: ["generated-image"],
  needsKey: true,

  buildGenerate(prompt, opts): RequestDescriptor {
    return {
      url: GEMINI_INTERACTIONS_API,
      method: "POST",
      headers: { "content-type": "application/json" },
      secretAccount: "provider:gemini-images",
      auth: { scheme: "header", name: "x-goog-api-key" },
      timeoutMs: 150_000,
      body: JSON.stringify({
        model: "gemini-3.1-flash-image",
        input: prompt,
        response_format: {
          type: "image",
          mime_type: "image/jpeg",
          aspect_ratio: opts.aspectRatio ?? "16:9",
          image_size: opts.quality === "high" ? "2K" : "1K",
        },
      }),
    };
  },

  parseGenerate(body: unknown): MediaResult {
    const parsed = body as GeminiImageResponse;
    const data = parsed?.output_image?.data;
    if (!data) throw new Error(parsed?.error?.message || "Gemini returned no generated image");
    return {
      kind: "generated-image",
      providerId: "gemini-images",
      payload: {
        kind: "generated-image",
        data,
        mimeType: parsed.output_image?.mime_type || "image/jpeg",
      },
      license: { id: "ai-generated", name: "AI-generated", requiresAttribution: false },
      attribution: {
        author: "Google Gemini",
        sourceUrl: "https://ai.google.dev/gemini-api/docs/image-generation",
      },
    };
  },
};
