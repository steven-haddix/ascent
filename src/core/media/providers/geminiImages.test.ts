import { describe, expect, it } from "vitest";
import { geminiImages } from "./geminiImages";

describe("Gemini image provider", () => {
  it("builds a keyed Gemini 3.1 image interaction", () => {
    const descriptor = geminiImages.buildGenerate("An exploded view of a camera", {
      aspectRatio: "16:9",
      quality: "high",
    });
    expect(descriptor.url).toContain("generativelanguage.googleapis.com/v1beta/interactions");
    expect(descriptor.secretAccount).toBe("provider:gemini-images");
    expect(descriptor.auth).toEqual({ scheme: "header", name: "x-goog-api-key" });
    expect(JSON.parse(descriptor.body!)).toMatchObject({
      model: "gemini-3.1-flash-image",
      response_format: { type: "image", aspect_ratio: "16:9", image_size: "2K" },
    });
  });

  it("parses base64 image output and preserves MIME type", () => {
    const result = geminiImages.parseGenerate({
      output_image: { data: "aGVsbG8=", mime_type: "image/webp" },
    });
    expect(result.providerId).toBe("gemini-images");
    expect(result.payload).toMatchObject({
      kind: "generated-image",
      data: "aGVsbG8=",
      mimeType: "image/webp",
    });
  });

  it("surfaces provider errors", () => {
    expect(() => geminiImages.parseGenerate({ error: { message: "quota exceeded" } })).toThrow("quota exceeded");
  });
});
