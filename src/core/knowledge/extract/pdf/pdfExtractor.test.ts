import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "none" as "none" | "hybrid" | "full",
  maxVisionPages: 20,
  vision: vi.fn(),
  destroy: vi.fn(async () => {}),
}));

vi.mock("../../../settings", () => ({
  getPdfExtractionSettings: () => ({ visionMode: state.mode, maxVisionPages: state.maxVisionPages }),
  getTaskModelSelection: () => ({ routeId: "anthropic", modelId: "vision-model", providerSettings: null }),
}));

vi.mock("./pdfjsAdapter", () => ({
  PDFJS_ADAPTER_VERSION: 2,
  loadPdfDocument: async () => ({
    numPages: 2,
    getPage: async (page: number) => ({ page }),
    getMetadata: async () => ({ info: { Title: "Test PDF" } }),
    destroy: state.destroy,
  }),
  extractLocalPdfPage: async (page: { page: number }, pageNumber: number) => {
    const text = page.page === 1 ? "A healthy page with embedded text and complete sentences." : "";
    return {
      page: pageNumber,
      width: 600,
      height: 800,
      lines: text ? [{ text, x: 50, endX: 400, y: 400, height: 10, breakAfter: true }] : [],
      text,
      stats: {
        itemCount: text ? 8 : 0,
        singleCharacterItems: 0,
        replacementCharacters: 0,
        alphabeticCharacters: text.length,
      },
    };
  },
}));

vi.mock("./visionAdapter", () => ({
  extractPdfPageWithVision: (...args: unknown[]) => state.vision(...args),
}));

import { pdfExtractor } from "./pdfExtractor";

describe("PDF extraction policy orchestration", () => {
  beforeEach(() => {
    state.mode = "none";
    state.maxVisionPages = 20;
    state.vision.mockReset();
    state.destroy.mockClear();
    state.vision.mockResolvedValue({ text: "Vision transcription", warnings: [] });
  });

  it("keeps the default path entirely local", async () => {
    const result = await pdfExtractor.extract({ bytes: new Uint8Array(), mime: "application/pdf", title: "x" });
    expect(state.vision).not.toHaveBeenCalled();
    expect(result.extractorId).toBe("local-pdf");
    expect(result.sections).toEqual([{ locator: "p.1", text: "A healthy page with embedded text and complete sentences." }]);
    expect(result.meta?.extraction?.pages.map((page) => page.provenance)).toEqual(["pdfjs", "pdfjs"]);
  });

  it("routes only weak pages through vision in hybrid mode", async () => {
    state.mode = "hybrid";
    const result = await pdfExtractor.extract({ bytes: new Uint8Array(), mime: "application/pdf", title: "x" });
    expect(state.vision).toHaveBeenCalledOnce();
    expect(state.vision.mock.calls[0][1]).toBe(2);
    expect(result.extractorId).toBe("pdf-hybrid");
    expect(result.sections[1]).toEqual({ locator: "p.2", text: "Vision transcription" });
    expect(result.meta?.extraction).toMatchObject({ routeId: "anthropic", modelId: "vision-model" });
  });

  it("honors the full-mode page cap and keeps local text for the remainder", async () => {
    state.mode = "full";
    state.maxVisionPages = 1;
    const result = await pdfExtractor.extract({ bytes: new Uint8Array(), mime: "application/pdf", title: "x" });
    expect(state.vision).toHaveBeenCalledOnce();
    expect(state.vision.mock.calls[0][1]).toBe(1);
    expect(result.sections[0].text).toBe("Vision transcription");
    expect(result.meta?.extraction?.pages.map((page) => page.provenance)).toEqual(["vision", "pdfjs"]);
    expect(state.destroy).toHaveBeenCalledOnce();
  });
});
