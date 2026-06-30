import { describe, expect, it } from "vitest";
import { openaiImages } from "./openaiImages";

describe("OpenAI image provider", () => {
  it("builds a keyed GPT Image 2 generation request", () => {
    const descriptor = openaiImages.buildGenerate("A cutaway view of a volcano", {
      size: "1536x864",
      quality: "medium",
    });
    expect(descriptor.url).toContain("api.openai.com/v1/images/generations");
    expect(descriptor.secretAccount).toBe("provider:openai-images");
    expect(JSON.parse(descriptor.body!)).toMatchObject({
      model: "gpt-image-2",
      size: "1536x864",
      quality: "medium",
      output_format: "jpeg",
    });
  });

  it("parses base64 image output", () => {
    const result = openaiImages.parseGenerate({ data: [{ b64_json: "aGVsbG8=" }] });
    expect(result.providerId).toBe("openai-images");
    expect(result.payload).toMatchObject({
      kind: "generated-image",
      data: "aGVsbG8=",
      mimeType: "image/jpeg",
    });
  });

  it("rejects empty output", () => {
    expect(() => openaiImages.parseGenerate({ data: [] })).toThrow("no generated image");
  });
});
